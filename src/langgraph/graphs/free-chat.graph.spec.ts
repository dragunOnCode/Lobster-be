import { MemorySaver } from '@langchain/langgraph';
import { FreeChatGraphService } from './free-chat.graph';
import { AgentHandoffService } from '../services/agent-handoff.service';

describe('FreeChatGraphService', () => {
  it('continues executing queued handoff tasks across agents', async () => {
    const savedMessages: Array<{ id: string; agentId?: string; content: string }> = [];
    let messageIndex = 0;
    const chatService = {
      getRecentMessages: jest.fn().mockResolvedValue([]),
      saveMessage: jest.fn().mockImplementation(async (input) => {
        messageIndex += 1;
        const message = {
          id: `m${messageIndex}`,
          sessionId: input.sessionId,
          userId: input.userId,
          agentId: input.agentId,
          agentName: input.agentName,
          role: input.role,
          content: input.content,
          mentionedAgents: input.mentionedAgents ?? [],
          createdAt: new Date(`2026-03-01T00:00:0${messageIndex}.000Z`),
        };
        savedMessages.push({ id: message.id, agentId: message.agentId, content: message.content });
        return message;
      }),
    };
    const sharedMemoryService = {
      getWorkspaceState: jest.fn().mockResolvedValue(null),
      setWorkspaceState: jest.fn().mockResolvedValue(undefined),
      setDecision: jest.fn().mockResolvedValue(undefined),
    };
    const agentService = {
      getAllAgents: jest.fn().mockResolvedValue([
        {
          id: 'codex-001',
          name: 'Codex',
          type: 'codex',
          callType: 'cli',
          generate: jest.fn().mockResolvedValue({
            content: 'design done, @Claude please implement',
            timestamp: new Date(),
          }),
          streamGenerate: jest.fn(),
        },
        {
          id: 'claude-001',
          name: 'Claude',
          type: 'claude',
          callType: 'cli',
          generate: jest.fn().mockResolvedValue({
            content: 'implementation finished',
            timestamp: new Date(),
          }),
          streamGenerate: jest.fn(),
        },
      ]),
      getAgent: jest.fn().mockImplementation(async (agentId: string) => {
        const agents = await agentService.getAllAgents();
        return agents.find((item) => item.id === agentId);
      }),
    };
    const decisionEngine = {
      decideAll: jest.fn().mockImplementation(async (message) => {
        if (message.content.includes('@Claude')) {
          return [
            {
              agent: (await agentService.getAgent('claude-001'))!,
              should: true,
              reason: 'mentioned',
              priority: 10,
            },
          ];
        }

        return [
          {
            agent: (await agentService.getAgent('codex-001'))!,
            should: true,
            reason: 'seed',
            priority: 10,
          },
        ];
      }),
    };
    const contextBuilder = {
      buildContext: jest.fn().mockResolvedValue({
        sessionId: 's1',
        conversationHistory: [],
        summaries: [],
      }),
    };

    const service = new FreeChatGraphService(
      chatService as never,
      sharedMemoryService as never,
      agentService as never,
      decisionEngine as never,
      contextBuilder as never,
      new AgentHandoffService(),
      {
        getCheckpointer: jest.fn().mockResolvedValue(new MemorySaver()),
      } as never,
    );

    const graph = await service.getGraph();
    const result = await graph.invoke(
      {
        sessionId: 's1',
        userId: 'u1',
        activeMessage: {
          id: 'user-1',
          sessionId: 's1',
          role: 'user',
          content: 'please ask Codex for a design first',
          userId: 'u1',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        history: [],
        workspaceState: undefined,
        summaries: [],
        pendingTasks: [],
        taskFingerprints: [],
        decisions: {},
        agentOutputs: [],
        events: [],
        completedTaskCount: 0,
        maxAgentTurns: 4,
        maxHandoffDepth: 4,
      },
      {
        configurable: {
          thread_id: 's1',
        },
      },
    );

    expect(result.agentOutputs.map((item) => item.agentId)).toEqual(['codex-001', 'claude-001']);
    expect(savedMessages.map((item) => item.agentId)).toEqual(['codex-001', 'claude-001']);
    expect(result.completedTaskCount).toBe(2);
  });

  it('emits stream events for http agents', async () => {
    const chatService = {
      getRecentMessages: jest.fn().mockResolvedValue([]),
      saveMessage: jest.fn().mockResolvedValue({
        id: 'm1',
        sessionId: 's1',
        userId: undefined,
        agentId: 'claude-001',
        agentName: 'Claude',
        role: 'assistant',
        content: 'Hello world',
        mentionedAgents: [],
        createdAt: new Date('2026-03-01T00:00:01.000Z'),
      }),
    };
    const sharedMemoryService = {
      getWorkspaceState: jest.fn().mockResolvedValue(null),
      setWorkspaceState: jest.fn().mockResolvedValue(undefined),
      setDecision: jest.fn().mockResolvedValue(undefined),
    };
    const httpAgent = {
      id: 'claude-001',
      name: 'Claude',
      type: 'claude',
      callType: 'http',
      generate: jest.fn(),
      streamGenerate: jest.fn().mockImplementation(async function* () {
        yield 'Hello ';
        yield 'world';
      }),
    };
    const agentService = {
      getAllAgents: jest.fn().mockResolvedValue([httpAgent]),
      getAgent: jest.fn().mockResolvedValue(httpAgent),
    };
    const decisionEngine = {
      decideAll: jest.fn().mockResolvedValue([
        {
          agent: httpAgent,
          should: true,
          reason: 'mentioned',
          priority: 10,
        },
      ]),
    };
    const contextBuilder = {
      buildContext: jest.fn().mockResolvedValue({
        sessionId: 's1',
        conversationHistory: [],
        summaries: [],
      }),
    };

    const service = new FreeChatGraphService(
      chatService as never,
      sharedMemoryService as never,
      agentService as never,
      decisionEngine as never,
      contextBuilder as never,
      new AgentHandoffService(),
      {
        getCheckpointer: jest.fn().mockResolvedValue(new MemorySaver()),
      } as never,
    );

    const graph = await service.getGraph();
    const result = await graph.invoke(
      {
        sessionId: 's1',
        userId: 'u1',
        activeMessage: {
          id: 'user-1',
          sessionId: 's1',
          role: 'user',
          content: '@Claude hello',
          userId: 'u1',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        history: [],
        workspaceState: undefined,
        summaries: [],
        pendingTasks: [],
        taskFingerprints: [],
        decisions: {},
        agentOutputs: [],
        events: [],
        completedTaskCount: 0,
        maxAgentTurns: 2,
        maxHandoffDepth: 4,
      },
      {
        configurable: {
          thread_id: 's1',
        },
      },
    );

    expect(result.agentOutputs[0].content).toBe('Hello world');
    expect(result.events.filter((item) => item.type === 'graph:agent_stream')).toHaveLength(2);
    expect(result.events.some((item) => item.type === 'graph:agent_stream_end')).toBe(true);
  });

  it('builds execution context from graph state and keeps retrieval as supplemental context only', async () => {
    const chatService = {
      getRecentMessages: jest.fn().mockResolvedValue([
        {
          id: 'h1',
          sessionId: 's1',
          role: 'user',
          content: 'graph history source',
          userId: 'u1',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ]),
      saveMessage: jest.fn().mockResolvedValue({
        id: 'm1',
        sessionId: 's1',
        userId: undefined,
        agentId: 'claude-001',
        agentName: 'Claude',
        role: 'assistant',
        content: 'done',
        mentionedAgents: [],
        createdAt: new Date('2026-03-01T00:00:01.000Z'),
      }),
    };
    const sharedMemoryService = {
      getWorkspaceState: jest.fn().mockResolvedValue({
        sessionId: 's1',
        updatedAt: '2026-03-01T00:00:00.000Z',
        graphOwned: true,
        autoSummary: 'graph summary',
      }),
      setWorkspaceState: jest.fn().mockResolvedValue(undefined),
      setDecision: jest.fn().mockResolvedValue(undefined),
    };
    const agent = {
      id: 'claude-001',
      name: 'Claude',
      type: 'claude',
      callType: 'cli',
      generate: jest.fn().mockResolvedValue({
        content: 'done',
        timestamp: new Date(),
      }),
      streamGenerate: jest.fn(),
    };
    const agentService = {
      getAllAgents: jest.fn().mockResolvedValue([agent]),
      getAgent: jest.fn().mockResolvedValue(agent),
    };
    const decisionEngine = {
      decideAll: jest.fn().mockResolvedValue([
        {
          agent,
          should: true,
          reason: 'mentioned',
          priority: 10,
        },
      ]),
    };
    const contextBuilder = {
      buildContext: jest.fn().mockResolvedValue({
        sessionId: 's1',
        conversationHistory: [{ id: 'semantic-only', sessionId: 's1', role: 'assistant', content: 'wrong source' }],
        semanticContext: [{ id: 'v1', content: 'semantic retrieval', similarity: 0.92 }],
        summaries: ['vector summary'],
        sharedMemory: { metadata: { stale: true } },
      }),
    };

    const service = new FreeChatGraphService(
      chatService as never,
      sharedMemoryService as never,
      agentService as never,
      decisionEngine as never,
      contextBuilder as never,
      new AgentHandoffService(),
      {
        getCheckpointer: jest.fn().mockResolvedValue(new MemorySaver()),
      } as never,
    );

    const graph = await service.getGraph();
    await graph.invoke(
      {
        sessionId: 's1',
        userId: 'u1',
        activeMessage: {
          id: 'user-1',
          sessionId: 's1',
          role: 'user',
          content: '@Claude review this',
          userId: 'u1',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        history: [],
        workspaceState: undefined,
        summaries: [],
        pendingTasks: [],
        taskFingerprints: [],
        decisions: {},
        agentOutputs: [],
        events: [],
        completedTaskCount: 0,
        maxAgentTurns: 2,
        maxHandoffDepth: 4,
      },
      {
        configurable: {
          thread_id: 's1',
        },
      },
    );

    expect(contextBuilder.buildContext).toHaveBeenCalledWith(
      's1',
      '@Claude review this',
      'u1',
      expect.objectContaining({
        conversationHistorySource: 'none',
        includeWorkspaceState: false,
      }),
    );
    expect(agent.generate).toHaveBeenCalledWith(
      '@Claude review this',
      expect.objectContaining({
        conversationHistory: [expect.objectContaining({ id: 'h1', content: 'graph history source' })],
        semanticContext: [expect.objectContaining({ id: 'v1', content: 'semantic retrieval' })],
        summaries: ['graph summary', 'vector summary'],
        sharedMemory: {
          metadata: expect.objectContaining({
            graphOwned: true,
          }),
        },
      }),
    );
  });
});
