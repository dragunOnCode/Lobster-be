import { ChatService } from '../chat/chat.service';
import { ChatGateway } from './chat.gateway';
import { MessageRouter } from './message.router';
import { SessionManager } from './session.manager';
import { AgentService } from '../agents/services/agent.service';
import { DecisionEngineService } from '../agents/services/decision-engine.service';
import { SharedMemoryService } from '../memory/services/shared-memory.service';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let sessionManager: SessionManager;
  let chatService: ChatService;
  let agentService: AgentService;
  let decisionEngine: DecisionEngineService;
  let sharedMemoryService: SharedMemoryService;
  let mockedAgent: any;

  beforeEach(() => {
    sessionManager = new SessionManager();
    chatService = new ChatService();
    mockedAgent = {
      id: 'claude-001',
      name: 'Claude',
      generate: jest.fn().mockResolvedValue({ content: 'mock response' }),
    };
    agentService = {
      getAllAgents: jest.fn().mockResolvedValue([mockedAgent]),
    } as unknown as AgentService;
    decisionEngine = {
      decideAll: jest.fn().mockResolvedValue([
        {
          agent: mockedAgent,
          should: true,
          reason: 'test',
          priority: 10,
        },
      ]),
    } as unknown as DecisionEngineService;
    sharedMemoryService = {
      setWorkspaceState: jest.fn(),
      getWorkspaceState: jest.fn().mockResolvedValue({ sessionId: 's1', updatedAt: new Date().toISOString() }),
      setDecision: jest.fn(),
      getDecision: jest.fn().mockResolvedValue(null),
    } as unknown as SharedMemoryService;
    gateway = new ChatGateway(
      sessionManager,
      new MessageRouter(),
      chatService,
      agentService,
      decisionEngine,
      sharedMemoryService,
    );
  });

  it('连接时缺少必填参数应断开', async () => {
    const disconnect = jest.fn();
    const emit = jest.fn();
    const join = jest.fn();
    const to = jest.fn().mockReturnValue({ emit: jest.fn() });
    const client = {
      id: 'client-1',
      handshake: { query: {} },
      disconnect,
      emit,
      join,
      to,
    } as any;

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('connection:error', expect.any(Object));
  });

  it('连接成功后应发送会话在线信息并通知其他成员', async () => {
    const clientAEmit = jest.fn();
    const clientBEmit = jest.fn();
    const clientA = {
      id: 'client-a',
      handshake: { query: { sessionId: 's1', userId: 'u1' } },
      emit: clientAEmit,
      join: jest.fn(),
      disconnect: jest.fn(),
    } as any;
    const clientB = {
      id: 'client-b',
      handshake: { query: { sessionId: 's1', userId: 'u2' } },
      emit: clientBEmit,
      join: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    await gateway.handleConnection(clientA);
    await gateway.handleConnection(clientB);

    expect(clientBEmit).toHaveBeenCalledWith(
      'session:presence',
      expect.objectContaining({
        sessionId: 's1',
        memberCount: 2,
        activeSessionCount: 1,
      }),
    );
    expect(clientAEmit).toHaveBeenCalledWith(
      'user:joined',
      expect.objectContaining({
        userId: 'u2',
        sessionId: 's1',
        memberCount: 2,
      }),
    );
  });

  it('发送消息后应广播到会话', async () => {
    const emit = jest.fn();
    const client = {
      id: 'client-2',
      handshake: { query: { userId: 'u1' } },
      emit,
    } as any;

    await sessionManager.addClient('s1', client);
    const result = await gateway.handleMessage(client, { content: 'hello', sessionId: 's1' });

    expect(result.ok).toBe(true);
    expect(emit).toHaveBeenCalledWith(
      'message:received',
      expect.objectContaining({
        sessionId: 's1',
        content: 'hello',
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      'agent:thinking',
      expect.objectContaining({
        agentId: 'claude-001',
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      'agent:response',
      expect.objectContaining({
        agentId: 'claude-001',
        sessionId: 's1',
      }),
    );
  });

  it('断开连接时应通知剩余成员并更新人数', async () => {
    const clientAEmit = jest.fn();
    const clientBEmit = jest.fn();
    const clientA = {
      id: 'client-a',
      handshake: { query: { sessionId: 's1', userId: 'u1' } },
      emit: clientAEmit,
      join: jest.fn(),
      disconnect: jest.fn(),
    } as any;
    const clientB = {
      id: 'client-b',
      handshake: { query: { sessionId: 's1', userId: 'u2' } },
      emit: clientBEmit,
      join: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    await gateway.handleConnection(clientA);
    await gateway.handleConnection(clientB);

    gateway.handleDisconnect(clientA);

    expect(clientBEmit).toHaveBeenCalledWith(
      'user:left',
      expect.objectContaining({
        userId: 'u1',
        sessionId: 's1',
        memberCount: 1,
        activeSessionCount: 1,
      }),
    );
  });

  it('HTTP Agent 应走流式事件推送', async () => {
    const streamAgent = {
      id: 'claude-001',
      name: 'Claude',
      callType: 'http' as const,
      async *streamGenerate() {
        yield 'Hel';
        yield 'lo';
      },
    };
    (agentService.getAllAgents as jest.Mock).mockResolvedValue([streamAgent]);
    (decisionEngine.decideAll as jest.Mock).mockResolvedValue([
      {
        agent: streamAgent,
        should: true,
        reason: 'test-stream',
        priority: 10,
      },
    ]);

    const emit = jest.fn();
    const client = {
      id: 'client-stream',
      handshake: { query: { userId: 'u1' } },
      emit,
    } as any;

    await sessionManager.addClient('s1', client);
    await gateway.handleMessage(client, { content: 'stream please', sessionId: 's1' });

    expect(emit).toHaveBeenCalledWith(
      'agent:stream',
      expect.objectContaining({
        agentId: 'claude-001',
        delta: 'Hello',
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      'agent:stream:end',
      expect.objectContaining({
        agentId: 'claude-001',
        fullContent: 'Hello',
      }),
    );
  });
});
