import { Injectable } from '@nestjs/common';
import {
  Annotation,
  END,
  getWriter,
  LangGraphRunnableConfig,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { AgentContext, ILLMAdapter, Message } from '../../agents/interfaces';
import { AgentService } from '../../agents/services/agent.service';
import { ContextBuilderService } from '../../agents/services/context-builder.service';
import { DecisionEngineService } from '../../agents/services/decision-engine.service';
import { ChatMessage, ChatService } from '../../chat/chat.service';
import { SharedMemoryService } from '../../memory/services/shared-memory.service';
import {
  ChatGraphDecision,
  ChatGraphEvent,
  ChatGraphMessage,
  ChatGraphOutput,
  ChatGraphState,
  ChatGraphTask,
} from '../interfaces/chat-graph-state.interface';
import { AgentHandoffService } from '../services/agent-handoff.service';
import { LangGraphCheckpointerService } from '../services/langgraph-checkpointer.service';

const ChatGraphStateAnnotation = Annotation.Root({
  sessionId: Annotation<string>(),
  userId: Annotation<string | undefined>(),
  activeMessage: Annotation<ChatGraphMessage | undefined>(),
  history: Annotation<ChatGraphMessage[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  workspaceState: Annotation<Record<string, unknown> | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  summaries: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  pendingTasks: Annotation<ChatGraphTask[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  taskFingerprints: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  decisions: Annotation<Record<string, ChatGraphDecision>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  agentOutputs: Annotation<ChatGraphOutput[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  events: Annotation<ChatGraphEvent[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  completedTaskCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  maxAgentTurns: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 8,
  }),
  maxHandoffDepth: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 4,
  }),
});

@Injectable()
export class FreeChatGraphService {
  private graphPromise?: Promise<Awaited<ReturnType<FreeChatGraphService['compileGraph']>>>;

  constructor(
    private readonly chatService: ChatService,
    private readonly sharedMemoryService: SharedMemoryService,
    private readonly agentService: AgentService,
    private readonly decisionEngine: DecisionEngineService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly handoffService: AgentHandoffService,
    private readonly checkpointerService: LangGraphCheckpointerService,
  ) {}

  async getGraph(): Promise<Awaited<ReturnType<FreeChatGraphService['compileGraph']>>> {
    if (!this.graphPromise) {
      this.graphPromise = this.compileGraph();
    }
    return this.graphPromise;
  }

  private async compileGraph() {
    const checkpointer = await this.checkpointerService.getCheckpointer();

    return new StateGraph(ChatGraphStateAnnotation)
      .addNode('hydrate_session_state', async (state, config) => this.hydrateSessionState(state, config))
      .addNode('route_current_message', async (state, config) => this.routeCurrentMessage(state, config))
      .addNode('run_next_task', async (state, config) => this.runNextTask(state, config))
      .addEdge(START, 'hydrate_session_state')
      .addEdge('hydrate_session_state', 'route_current_message')
      .addConditionalEdges('route_current_message', (state) => (this.hasPendingTasks(state) ? 'run_next_task' : END))
      .addConditionalEdges('run_next_task', (state) => (this.shouldContinue(state) ? 'run_next_task' : END))
      .compile({
        checkpointer,
        name: 'lobster-free-chat',
      });
  }

  private async hydrateSessionState(
    state: ChatGraphState,
    config?: LangGraphRunnableConfig,
  ): Promise<Partial<ChatGraphState>> {
    const history = await this.chatService.getRecentMessages(state.sessionId, 50);
    const workspaceState = await this.sharedMemoryService.getWorkspaceState(state.sessionId);
    const hydratedEvent: ChatGraphEvent = {
      type: 'graph:hydrated',
      payload: {
        sessionId: state.sessionId,
        historyItems: history.length,
      },
      createdAt: new Date().toISOString(),
    };

    return {
      history: history.map((item) => this.toGraphMessage(item)),
      workspaceState: workspaceState ?? state.workspaceState,
      summaries: this.extractSummariesFromWorkspaceState(workspaceState ?? state.workspaceState),
      events: this.appendAndEmitEvents(state.events, [hydratedEvent], config),
    };
  }

  private async routeCurrentMessage(
    state: ChatGraphState,
    config?: LangGraphRunnableConfig,
  ): Promise<Partial<ChatGraphState>> {
    if (!state.activeMessage || state.pendingTasks.length > 0) {
      return {};
    }

    const agents = await this.agentService.getAllAgents();
    const context = this.buildDecisionContext(state);
    const decisions = await this.decisionEngine.decideAll(this.toAdapterMessage(state.activeMessage), agents, context);

    const nextDecisions = { ...state.decisions };
    const freshTasks: ChatGraphTask[] = [];
    const routeEvents: ChatGraphEvent[] = [];
    const timestamp = new Date().toISOString();

    for (const decision of decisions) {
      nextDecisions[decision.agent.id] = {
        should: decision.should,
        reason: decision.reason,
        priority: decision.priority,
        triggerMessageId: state.activeMessage.id,
      };

      await this.sharedMemoryService.setDecision(state.sessionId, decision.agent.id, {
        agentId: decision.agent.id,
        should: decision.should,
        reason: decision.reason,
        priority: decision.priority,
        timestamp,
      });

      if (!decision.should) {
        routeEvents.push({
          type: 'graph:agent_skip',
          payload: {
            sessionId: state.sessionId,
            agentId: decision.agent.id,
            agentName: decision.agent.name,
            reason: decision.reason,
            triggerMessageId: state.activeMessage.id,
          },
          createdAt: timestamp,
        });
        continue;
      }

      freshTasks.push({
        agentId: decision.agent.id,
        triggerMessageId: state.activeMessage.id,
        triggerRole: state.activeMessage.role,
        triggerContent: state.activeMessage.content,
        reason: decision.reason,
        depth: 0,
        sourceAgentId: state.activeMessage.agentId,
      });
      routeEvents.push({
        type: 'graph:agent_thinking',
        payload: {
          sessionId: state.sessionId,
          agentId: decision.agent.id,
          agentName: decision.agent.name,
          reason: decision.reason,
          priority: decision.priority,
          triggerMessageId: state.activeMessage.id,
        },
        createdAt: timestamp,
      });
    }

    const enqueued = this.enqueueTasks(state.pendingTasks, state.taskFingerprints, freshTasks);
    routeEvents.push({
      type: 'graph:routed',
      payload: {
        triggerMessageId: state.activeMessage.id,
        tasks: freshTasks.map((item) => ({
          agentId: item.agentId,
          reason: item.reason,
        })),
      },
      createdAt: timestamp,
    });

    return {
      pendingTasks: enqueued.tasks,
      taskFingerprints: enqueued.fingerprints,
      decisions: nextDecisions,
      events: this.appendAndEmitEvents(state.events, routeEvents, config),
    };
  }

  private async runNextTask(
    state: ChatGraphState,
    config?: LangGraphRunnableConfig,
  ): Promise<Partial<ChatGraphState>> {
    if (state.pendingTasks.length === 0 || state.completedTaskCount >= state.maxAgentTurns) {
      return {};
    }

    const [task, ...remainingTasks] = state.pendingTasks;
    const agent = await this.agentService.getAgent(task.agentId);
    const context = await this.buildAgentContext(state, task);
    const execution = await this.generateAgentContent(state, agent, task.triggerContent, context, config);
    const assistantMessage = await this.chatService.saveMessage({
      sessionId: state.sessionId,
      role: 'assistant',
      agentId: agent.id,
      agentName: agent.name,
      content: execution.content,
    });

    const assistantGraphMessage = this.toGraphMessage(assistantMessage);
    const agents = await this.agentService.getAllAgents();
    const handoffTargets = this.handoffService
      .resolveTargets(execution.content, agents)
      .filter((agentId) => agentId !== agent.id);

    const handoffTasks = handoffTargets.map<ChatGraphTask>((agentId) => ({
      agentId,
      triggerMessageId: assistantGraphMessage.id,
      triggerRole: assistantGraphMessage.role,
      triggerContent: assistantGraphMessage.content,
      reason: `handoff from ${agent.id}`,
      depth: task.depth + 1,
      sourceAgentId: agent.id,
    })).filter((item) => item.depth <= state.maxHandoffDepth);
    const enqueued = this.enqueueTasks(remainingTasks, state.taskFingerprints, handoffTasks);
    const nextHistory = [...state.history, assistantGraphMessage];
    const nextOutputs = [
      ...state.agentOutputs,
      {
        agentId: agent.id,
        agentName: agent.name,
        content: execution.content,
        messageId: assistantGraphMessage.id,
        triggerMessageId: task.triggerMessageId,
        handoffTargets,
        createdAt: assistantGraphMessage.createdAt,
      },
    ];
    const nextWorkspaceState = await this.persistAgentWorkspaceState(state, agent, assistantGraphMessage);
    let nextEvents = [...state.events, ...execution.streamEvents];
    if (execution.streamEvents.length > 0) {
      const streamEndEvent: ChatGraphEvent = {
        type: 'graph:agent_stream_end',
        payload: {
          sessionId: state.sessionId,
          agentId: agent.id,
          agentName: agent.name,
          messageId: assistantGraphMessage.id,
          fullContent: assistantGraphMessage.content,
        },
        createdAt: assistantGraphMessage.createdAt,
      };
      this.emitCustomEvent(config, streamEndEvent);
      nextEvents = this.appendEvent(nextEvents, streamEndEvent);
    }

    const responseEvent: ChatGraphEvent = {
      type: 'graph:agent_response',
      payload: {
        sessionId: state.sessionId,
        agentId: agent.id,
        agentName: agent.name,
        triggerMessageId: task.triggerMessageId,
        messageId: assistantGraphMessage.id,
        message: {
          id: assistantGraphMessage.id,
          sessionId: assistantGraphMessage.sessionId,
          role: assistantGraphMessage.role,
          content: assistantGraphMessage.content,
          agentId: assistantGraphMessage.agentId,
          agentName: assistantGraphMessage.agentName,
          createdAt: assistantGraphMessage.createdAt,
        },
      },
      createdAt: assistantGraphMessage.createdAt,
    };
    this.emitCustomEvent(config, responseEvent);
    nextEvents = this.appendEvent(nextEvents, responseEvent);

    const handoffEvent: ChatGraphEvent = {
      type: 'graph:handoff',
      payload: {
        sessionId: state.sessionId,
        from: agent.id,
        to: handoffTargets,
        messageId: assistantGraphMessage.id,
        depth: task.depth + 1,
      },
      createdAt: assistantGraphMessage.createdAt,
    };
    this.emitCustomEvent(config, handoffEvent);
    nextEvents = this.appendEvent(nextEvents, handoffEvent);

    return {
      activeMessage: assistantGraphMessage,
      history: nextHistory,
      pendingTasks: enqueued.tasks,
      taskFingerprints: enqueued.fingerprints,
      workspaceState: nextWorkspaceState,
      summaries: this.extractSummariesFromWorkspaceState(nextWorkspaceState),
      completedTaskCount: state.completedTaskCount + 1,
      agentOutputs: nextOutputs,
      events: nextEvents,
    };
  }

  private hasPendingTasks(state: ChatGraphState): boolean {
    return state.pendingTasks.length > 0;
  }

  private shouldContinue(state: ChatGraphState): boolean {
    return state.pendingTasks.length > 0 && state.completedTaskCount < state.maxAgentTurns;
  }

  private async buildAgentContext(state: ChatGraphState, task: ChatGraphTask): Promise<AgentContext> {
    const built = await this.contextBuilder.buildContext(state.sessionId, task.triggerContent, state.userId, {
      conversationHistorySource: 'none',
      includeWorkspaceState: false,
    });
    return {
      sessionId: state.sessionId,
      userId: state.userId,
      conversationHistory: state.history.map((item) => this.toAdapterMessage(item)),
      semanticContext: built.semanticContext,
      summaries: this.mergeSummaries(state.summaries, built.summaries ?? []),
      sharedMemory: {
        metadata: {
          ...(state.workspaceState ?? {}),
          lastAgentOutputs: state.agentOutputs.slice(-5).map((item) => ({
            agentId: item.agentId,
            messageId: item.messageId,
            createdAt: item.createdAt,
            handoffTargets: item.handoffTargets,
          })),
        },
      },
    };
  }

  private async generateAgentContent(
    state: ChatGraphState,
    agent: Pick<ILLMAdapter, 'id' | 'name' | 'callType' | 'generate' | 'streamGenerate'>,
    prompt: string,
    context: AgentContext,
    config?: LangGraphRunnableConfig,
  ): Promise<{ content: string; streamEvents: ChatGraphEvent[] }> {
    if (agent.callType !== 'http') {
      const response = await agent.generate(prompt, context);
      return {
        content: response.content,
        streamEvents: [],
      };
    }

    const chunks: string[] = [];
    const streamEvents: ChatGraphEvent[] = [];
    for await (const chunk of agent.streamGenerate(prompt, context)) {
      if (!chunk) {
        continue;
      }

      chunks.push(chunk);
      const streamEvent: ChatGraphEvent = {
        type: 'graph:agent_stream',
        payload: {
          sessionId: state.sessionId,
          agentId: agent.id,
          agentName: agent.name,
          delta: chunk,
        },
        createdAt: new Date().toISOString(),
      };
      this.emitCustomEvent(config, streamEvent);
      streamEvents.push(streamEvent);
    }

    return {
      content: chunks.join(''),
      streamEvents,
    };
  }

  private buildDecisionContext(state: ChatGraphState): AgentContext {
    return {
      sessionId: state.sessionId,
      userId: state.userId,
      conversationHistory: state.history.map((item) => this.toAdapterMessage(item)),
      summaries: state.summaries,
      sharedMemory: state.workspaceState
        ? {
            metadata: state.workspaceState,
          }
        : undefined,
    };
  }

  private enqueueTasks(
    existingTasks: ChatGraphTask[],
    existingFingerprints: string[],
    nextTasks: ChatGraphTask[],
  ): { tasks: ChatGraphTask[]; fingerprints: string[] } {
    const fingerprints = new Set(existingFingerprints);
    const tasks = [...existingTasks];

    for (const task of nextTasks) {
      const fingerprint = this.getTaskFingerprint(task);
      if (fingerprints.has(fingerprint)) {
        continue;
      }
      fingerprints.add(fingerprint);
      tasks.push(task);
    }

    return {
      tasks,
      fingerprints: Array.from(fingerprints),
    };
  }

  private getTaskFingerprint(task: ChatGraphTask): string {
    return `${task.agentId}:${task.triggerMessageId}`;
  }

  private async persistAgentWorkspaceState(
    state: ChatGraphState,
    agent: Pick<ILLMAdapter, 'id' | 'name'>,
    assistantMessage: ChatGraphMessage,
  ): Promise<Record<string, unknown>> {
    const nextWorkspaceState: Record<string, unknown> = {
      ...(state.workspaceState ?? {}),
      sessionId: state.sessionId,
      updatedAt: assistantMessage.createdAt,
      lastAgentMessageId: assistantMessage.id,
      lastAgentId: agent.id,
      lastAgentName: agent.name,
      lastAgentOutputs: {
        ...((state.workspaceState?.lastAgentOutputs as Record<string, unknown> | undefined) ?? {}),
        [agent.id]: {
          messageId: assistantMessage.id,
          contentPreview: assistantMessage.content.slice(0, 200),
          updatedAt: assistantMessage.createdAt,
        },
      },
    };

    await this.sharedMemoryService.setWorkspaceState(state.sessionId, {
      sessionId: state.sessionId,
      updatedAt: assistantMessage.createdAt,
      ...(nextWorkspaceState as Record<string, unknown>),
    });

    return nextWorkspaceState;
  }

  private appendEvent(events: ChatGraphEvent[], event: ChatGraphEvent): ChatGraphEvent[] {
    return [...events, event];
  }

  private appendAndEmitEvents(
    events: ChatGraphEvent[],
    nextEvents: ChatGraphEvent[],
    config?: LangGraphRunnableConfig,
  ): ChatGraphEvent[] {
    for (const event of nextEvents) {
      this.emitCustomEvent(config, event);
    }
    return [...events, ...nextEvents];
  }

  private emitCustomEvent(config: LangGraphRunnableConfig | undefined, event: ChatGraphEvent): void {
    const writer = getWriter(config);
    writer?.(event);
  }

  private extractSummariesFromWorkspaceState(workspaceState?: Record<string, unknown>): string[] {
    if (!workspaceState) {
      return [];
    }
    const summary = workspaceState.autoSummary;
    return typeof summary === 'string' && summary.trim().length > 0 ? [summary] : [];
  }

  private mergeSummaries(primary: string[], secondary: string[]): string[] {
    const merged = [...primary, ...secondary]
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return Array.from(new Set(merged));
  }

  private toGraphMessage(message: ChatMessage): ChatGraphMessage {
    return {
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      userId: message.userId,
      agentId: message.agentId,
      agentName: message.agentName,
      mentionedAgents: message.mentionedAgents ?? [],
      createdAt: message.createdAt.toISOString(),
    };
  }

  private toAdapterMessage(message: ChatGraphMessage): Message {
    return {
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      userId: message.userId,
      agentId: message.agentId,
      createdAt: new Date(message.createdAt),
    };
  }
}
