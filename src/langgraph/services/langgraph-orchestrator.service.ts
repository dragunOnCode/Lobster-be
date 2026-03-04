import { Injectable } from '@nestjs/common';
import { ChatMessage, ChatService } from '../../chat/chat.service';
import { SharedMemoryService } from '../../memory/services/shared-memory.service';
import { ChatGraphEvent, ChatGraphState } from '../interfaces/chat-graph-state.interface';
import { FreeChatGraphService } from '../graphs/free-chat.graph';

export interface RunTurnInput {
  sessionId: string;
  userId?: string;
  content: string;
  mentionedAgents?: string[];
}

export type LangGraphStreamChunk =
  | { mode: 'custom'; payload: ChatGraphEvent }
  | { mode: 'values'; payload: ChatGraphState };

@Injectable()
export class LangGraphOrchestratorService {
  constructor(
    private readonly freeChatGraphService: FreeChatGraphService,
    private readonly chatService: ChatService,
    private readonly sharedMemoryService: SharedMemoryService,
  ) {}

  async runTurn(input: RunTurnInput): Promise<ChatGraphState> {
    const userMessage = await this.chatService.saveMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'user',
      content: input.content,
      mentionedAgents: input.mentionedAgents ?? [],
    });

    return this.runTurnFromSavedMessage(userMessage);
  }

  async runTurnFromSavedMessage(message: Pick<ChatMessage, 'id' | 'sessionId' | 'role' | 'content' | 'createdAt' | 'userId'>): Promise<ChatGraphState> {
    this.assertUserMessage(message);

    const workspaceState = await this.prepareWorkspaceState(message);
    const graph = await this.freeChatGraphService.getGraph();

    return graph.invoke(
      this.buildInitialState(message, workspaceState),
      {
        configurable: {
          thread_id: message.sessionId,
        },
      },
    ) as Promise<ChatGraphState>;
  }

  async *streamTurnFromSavedMessage(
    message: Pick<ChatMessage, 'id' | 'sessionId' | 'role' | 'content' | 'createdAt' | 'userId'>,
  ): AsyncGenerator<LangGraphStreamChunk> {
    this.assertUserMessage(message);

    const workspaceState = await this.prepareWorkspaceState(message);
    const initialState = this.buildInitialState(message, workspaceState);
    const graph = await this.freeChatGraphService.getGraph();
    const stream = await graph.stream(initialState, {
      configurable: {
        thread_id: message.sessionId,
      },
      streamMode: ['custom', 'values'],
    });

    for await (const chunk of stream) {
      const [mode, payload] = chunk as ['custom' | 'values', ChatGraphEvent | ChatGraphState];
      if (mode === 'custom') {
        yield { mode, payload: payload as ChatGraphEvent };
        continue;
      }

      yield { mode, payload: payload as ChatGraphState };
    }
  }

  private assertUserMessage(
    message: Pick<ChatMessage, 'id' | 'sessionId' | 'role' | 'content' | 'createdAt' | 'userId'>,
  ): void {
    if (message.role !== 'user') {
      throw new Error('LangGraph orchestrator currently expects a user message as the entrypoint');
    }
  }

  private async prepareWorkspaceState(
    message: Pick<ChatMessage, 'sessionId' | 'content' | 'createdAt'>,
  ): Promise<Record<string, unknown> | undefined> {
    const existingWorkspaceState = await this.sharedMemoryService.getWorkspaceState(message.sessionId);
    const nextWorkspaceState = {
      ...(existingWorkspaceState ?? {}),
      sessionId: message.sessionId,
      updatedAt: message.createdAt.toISOString(),
      lastUserMessage: message.content,
    };
    await this.sharedMemoryService.setWorkspaceState(message.sessionId, nextWorkspaceState);
    return nextWorkspaceState;
  }

  private buildInitialState(
    message: Pick<ChatMessage, 'id' | 'sessionId' | 'role' | 'content' | 'createdAt' | 'userId'>,
    workspaceState?: Record<string, unknown>,
  ): ChatGraphState {
    return {
      sessionId: message.sessionId,
      userId: message.userId,
      activeMessage: {
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        userId: message.userId,
        createdAt: message.createdAt.toISOString(),
      },
      history: [],
      workspaceState,
      summaries: [],
      pendingTasks: [],
      taskFingerprints: [],
      decisions: {},
      agentOutputs: [],
      events: [],
      completedTaskCount: 0,
      maxAgentTurns: 8,
      maxHandoffDepth: 4,
    };
  }
}
