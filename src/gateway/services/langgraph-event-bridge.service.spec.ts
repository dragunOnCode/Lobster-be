import { LangGraphEventBridgeService } from './langgraph-event-bridge.service';

describe('LangGraphEventBridgeService', () => {
  it('应将 graph response 事件转换为 websocket 事件', () => {
    const service = new LangGraphEventBridgeService();
    const events = service.toSessionEvents([
      {
        type: 'graph:agent_response',
        payload: {
          sessionId: 's1',
          agentId: 'claude-001',
          agentName: 'Claude',
          messageId: 'm1',
          message: {
            id: 'm1',
            sessionId: 's1',
            role: 'assistant',
            content: 'done',
            agentId: 'claude-001',
            agentName: 'Claude',
            createdAt: '2026-03-01T00:00:00.000Z',
          },
        },
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ]);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(
      expect.objectContaining({
        event: 'message:received',
        payload: expect.objectContaining({
          id: 'm1',
          content: 'done',
        }),
      }),
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        event: 'agent:response',
        payload: expect.objectContaining({
          agentId: 'claude-001',
          messageId: 'm1',
        }),
      }),
    );
  });

  it('应将 graph stream 事件转换为 websocket stream 事件', () => {
    const service = new LangGraphEventBridgeService();

    const events = service.toSessionEventsFromGraphEvent({
      type: 'graph:agent_stream',
      payload: {
        sessionId: 's1',
        agentId: 'claude-001',
        agentName: 'Claude',
        delta: 'partial',
      },
      createdAt: '2026-03-01T00:00:00.000Z',
    });

    expect(events).toEqual([
      {
        event: 'agent:stream',
        payload: {
          sessionId: 's1',
          agentId: 'claude-001',
          agentName: 'Claude',
          delta: 'partial',
          timestamp: '2026-03-01T00:00:00.000Z',
        },
      },
    ]);
  });
});
