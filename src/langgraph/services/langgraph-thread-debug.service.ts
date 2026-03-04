import { Injectable, NotFoundException } from '@nestjs/common';
import { RunnableConfig } from '@langchain/core/runnables';
import { StateSnapshot } from '@langchain/langgraph';
import { ChatService } from '../../chat/chat.service';
import { AgentDecisionSnapshot, SharedMemoryService, WorkspaceState } from '../../memory/services/shared-memory.service';
import { TranscriptService } from '../../workspace/transcript.service';
import { TranscriptEvent } from '../../workspace/workspace.service';
import { FreeChatGraphService } from '../graphs/free-chat.graph';
import { ChatGraphState } from '../interfaces/chat-graph-state.interface';

export interface ThreadStateView {
  threadId: string;
  checkpointId?: string;
  parentCheckpointId?: string;
  createdAt?: string;
  next: string[];
  metadata?: Record<string, unknown>;
  tasks: Array<{
    id: string;
    name: string;
    interrupts: unknown[];
    error?: unknown;
  }>;
  values: ChatGraphState | Record<string, unknown>;
}

export interface ThreadReplayView {
  thread: ThreadStateView;
  history: ThreadStateView[];
  transcript: unknown[];
  messages: Awaited<ReturnType<ChatService['getRecentMessages']>>;
}

@Injectable()
export class LangGraphThreadDebugService {
  constructor(
    private readonly freeChatGraphService: FreeChatGraphService,
    private readonly chatService: ChatService,
    private readonly transcriptService: TranscriptService,
    private readonly sharedMemoryService: SharedMemoryService,
  ) {}

  async getThreadState(threadId: string, checkpointId?: string): Promise<ThreadStateView> {
    const graph = await this.freeChatGraphService.getGraph();
    const snapshot = await graph.getState(this.toThreadConfig(threadId, checkpointId));
    return this.toThreadStateView(threadId, snapshot);
  }

  async getThreadHistory(threadId: string, limit = 20): Promise<ThreadStateView[]> {
    const graph = await this.freeChatGraphService.getGraph();
    const history: ThreadStateView[] = [];

    for await (const snapshot of graph.getStateHistory(this.toThreadConfig(threadId), { limit })) {
      history.push(this.toThreadStateView(threadId, snapshot));
    }

    return history;
  }

  async getReplayView(threadId: string, options?: { checkpointId?: string; historyLimit?: number; messageLimit?: number }) {
    const [thread, history, transcript, messages] = await Promise.all([
      this.getThreadState(threadId, options?.checkpointId),
      this.getThreadHistory(threadId, options?.historyLimit ?? 20),
      this.readTranscriptSafe(threadId),
      this.chatService.getRecentMessages(threadId, options?.messageLimit ?? 50),
    ]);

    return {
      thread,
      history: [...history].reverse(),
      transcript,
      messages,
    } satisfies ThreadReplayView;
  }

  async restoreThreadState(threadId: string, checkpointId: string): Promise<ThreadStateView> {
    const graph = await this.freeChatGraphService.getGraph();
    const snapshot = await graph.getState(this.toThreadConfig(threadId, checkpointId));
    const values = snapshot.values as ChatGraphState | Record<string, unknown>;
    const checkpointCreatedAt = snapshot.createdAt ?? new Date().toISOString();

    // Restore is intentionally scoped to conversation state and its derived stores.
    // It does not rewind workspace/code files or any other external side effects.
    await graph.updateState(this.toThreadConfig(threadId), values, 'hydrate_session_state');
    if (this.isChatGraphState(values)) {
      await this.restoreChatMessages(threadId, values);
      await this.restoreTranscript(threadId, checkpointCreatedAt);
      await this.restoreSharedMemory(threadId, values, checkpointCreatedAt);
    }
    return this.getThreadState(threadId);
  }

  private async readTranscriptSafe(threadId: string): Promise<unknown[]> {
    try {
      return await this.transcriptService.readEvents(threadId);
    } catch {
      return [];
    }
  }

  private async restoreChatMessages(threadId: string, state: ChatGraphState): Promise<void> {
    await this.chatService.replaceSessionMessages(
      threadId,
      state.history.map((message) => ({
        id: message.id,
        sessionId: message.sessionId,
        userId: message.userId,
        agentId: message.agentId,
        agentName: message.agentName,
        role: message.role,
        content: message.content,
        mentionedAgents: message.mentionedAgents ?? [],
        createdAt: new Date(message.createdAt),
      })),
    );
  }

  private async restoreTranscript(threadId: string, checkpointCreatedAt: string): Promise<void> {
    const transcript = await this.readTranscriptSafe(threadId);
    const restoredTranscript = transcript
      .filter((event) => this.shouldKeepTranscriptEvent(event, checkpointCreatedAt))
      .map((event) => event as TranscriptEvent);

    await this.transcriptService.replaceEvents(threadId, restoredTranscript);
  }

  private shouldKeepTranscriptEvent(event: unknown, checkpointCreatedAt: string): boolean {
    const timestamp = this.toOptionalString((event as { timestamp?: unknown })?.timestamp);
    if (!timestamp) {
      return true;
    }

    const eventTime = Date.parse(timestamp);
    const checkpointTime = Date.parse(checkpointCreatedAt);
    if (Number.isNaN(eventTime) || Number.isNaN(checkpointTime)) {
      return true;
    }

    return eventTime <= checkpointTime;
  }

  private async restoreSharedMemory(threadId: string, state: ChatGraphState, checkpointCreatedAt: string): Promise<void> {
    await this.sharedMemoryService.clearSession(threadId);

    const workspaceState = this.toWorkspaceState(threadId, state.workspaceState, checkpointCreatedAt);
    if (workspaceState) {
      await this.sharedMemoryService.setWorkspaceState(threadId, workspaceState);
    }

    const decisions = this.toDecisionSnapshots(state, checkpointCreatedAt);
    await Promise.all(
      decisions.map((decision) => this.sharedMemoryService.setDecision(threadId, decision.agentId, decision)),
    );
  }

  private toWorkspaceState(
    threadId: string,
    workspaceState: ChatGraphState['workspaceState'],
    checkpointCreatedAt: string,
  ): WorkspaceState | null {
    if (!workspaceState) {
      return null;
    }

    return {
      sessionId: threadId,
      updatedAt: this.toOptionalString(workspaceState.updatedAt) ?? checkpointCreatedAt,
      ...(workspaceState as Record<string, unknown>),
    };
  }

  private toDecisionSnapshots(state: ChatGraphState, checkpointCreatedAt: string): AgentDecisionSnapshot[] {
    return Object.entries(state.decisions).map(([agentId, decision]) => ({
      agentId,
      should: decision.should,
      reason: decision.reason,
      priority: decision.priority,
      timestamp: checkpointCreatedAt,
    }));
  }

  private isChatGraphState(value: unknown): value is ChatGraphState {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<ChatGraphState>;
    return typeof candidate.sessionId === 'string' && Array.isArray(candidate.history) && Array.isArray(candidate.events);
  }

  private toThreadConfig(threadId: string, checkpointId?: string): RunnableConfig {
    return {
      configurable: {
        thread_id: threadId,
        ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
      },
    };
  }

  private toThreadStateView(threadId: string, snapshot?: StateSnapshot): ThreadStateView {
    if (!snapshot) {
      throw new NotFoundException(`LangGraph thread not found: ${threadId}`);
    }

    const configurable = (snapshot.config?.configurable ?? {}) as Record<string, unknown>;
    const parentConfigurable = (snapshot.parentConfig?.configurable ?? {}) as Record<string, unknown>;

    return {
      threadId,
      checkpointId: this.toOptionalString(configurable.checkpoint_id),
      parentCheckpointId: this.toOptionalString(parentConfigurable.checkpoint_id),
      createdAt: snapshot.createdAt,
      next: [...snapshot.next],
      metadata: snapshot.metadata as Record<string, unknown> | undefined,
      tasks: snapshot.tasks.map((task) => ({
        id: task.id,
        name: task.name,
        interrupts: task.interrupts,
        error: task.error,
      })),
      values: snapshot.values as ChatGraphState | Record<string, unknown>,
    };
  }

  private toOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }
}
