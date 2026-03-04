import { ChatService } from '../chat/chat.service';
import { LangGraphOrchestratorService } from '../langgraph/services/langgraph-orchestrator.service';
import { ChatGateway } from './chat.gateway';
import { MessageRouter } from './message.router';
import { SessionManager } from './session.manager';
import { LangGraphEventBridgeService } from './services/langgraph-event-bridge.service';

async function* streamChunks(chunks: Array<{ mode: 'custom' | 'values'; payload: Record<string, unknown> }>) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let sessionManager: SessionManager;
  let chatService: ChatService;
  let langGraphOrchestrator: LangGraphOrchestratorService;

  beforeEach(() => {
    sessionManager = new SessionManager();
    chatService = new ChatService();
    langGraphOrchestrator = {
      streamTurnFromSavedMessage: jest.fn().mockImplementation(() =>
        streamChunks([
          {
            mode: 'custom',
            payload: {
              type: 'graph:agent_thinking',
              payload: {
                sessionId: 's1',
                agentId: 'claude-001',
                agentName: 'Claude',
                reason: 'test',
              },
              createdAt: new Date().toISOString(),
            },
          },
          {
            mode: 'custom',
            payload: {
              type: 'graph:agent_stream',
              payload: {
                sessionId: 's1',
                agentId: 'claude-001',
                agentName: 'Claude',
                delta: 'mock partial',
              },
              createdAt: new Date().toISOString(),
            },
          },
          {
            mode: 'custom',
            payload: {
              type: 'graph:agent_response',
              payload: {
                sessionId: 's1',
                agentId: 'claude-001',
                agentName: 'Claude',
                messageId: 'm-assistant',
                message: {
                  id: 'm-assistant',
                  sessionId: 's1',
                  role: 'assistant',
                  content: 'mock response',
                  agentId: 'claude-001',
                  agentName: 'Claude',
                  createdAt: new Date().toISOString(),
                },
              },
              createdAt: new Date().toISOString(),
            },
          },
        ]),
      ),
    } as unknown as LangGraphOrchestratorService;

    gateway = new ChatGateway(
      sessionManager,
      new MessageRouter(),
      chatService,
      langGraphOrchestrator,
      new LangGraphEventBridgeService(),
    );
  });

  it('should reject connections without sessionId or userId', async () => {
    const disconnect = jest.fn();
    const emit = jest.fn();
    const join = jest.fn();
    const client = {
      id: 'client-1',
      handshake: { query: {} },
      disconnect,
      emit,
      join,
    } as any;

    await gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('connection:error', expect.any(Object));
  });

  it('should broadcast presence updates to other members in the same session', async () => {
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

  it('should stream graph events back to the websocket session', async () => {
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
      'agent:stream',
      expect.objectContaining({
        agentId: 'claude-001',
        delta: 'mock partial',
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

  it('should broadcast leave events when a client disconnects', async () => {
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

  it('should surface graph execution failures as agent:error', async () => {
    (langGraphOrchestrator.streamTurnFromSavedMessage as jest.Mock).mockImplementation(
      async function* () {
        throw new Error('graph failed');
      },
    );
    const emit = jest.fn();
    const client = {
      id: 'client-error',
      handshake: { query: { userId: 'u1' } },
      emit,
    } as any;

    await sessionManager.addClient('s1', client);
    const result = await gateway.handleMessage(client, { content: 'hello', sessionId: 's1' });

    expect(result.ok).toBe(true);
    expect(emit).toHaveBeenCalledWith(
      'agent:error',
      expect.objectContaining({
        sessionId: 's1',
        error: 'graph failed',
      }),
    );
  });
});
