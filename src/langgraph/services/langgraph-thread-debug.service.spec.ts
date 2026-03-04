import { LangGraphThreadDebugService } from './langgraph-thread-debug.service';

function createSnapshot(overrides?: Record<string, unknown>) {
  return {
    values: {
      sessionId: 's1',
      history: [],
      summaries: [],
      pendingTasks: [],
      taskFingerprints: [],
      decisions: {},
      agentOutputs: [],
      events: [],
      completedTaskCount: 0,
      maxAgentTurns: 8,
      maxHandoffDepth: 4,
    },
    next: ['run_next_task'],
    config: {
      configurable: {
        thread_id: 's1',
        checkpoint_id: 'cp-2',
      },
    },
    metadata: {
      source: 'loop',
    },
    createdAt: '2026-03-02T00:00:00.000Z',
    parentConfig: {
      configurable: {
        thread_id: 's1',
        checkpoint_id: 'cp-1',
      },
    },
    tasks: [
      {
        id: 'task-1',
        name: 'run_next_task',
        interrupts: [],
      },
    ],
    ...overrides,
  };
}

describe('LangGraphThreadDebugService', () => {
  it('returns a normalized thread state view', async () => {
    const graph = {
      getState: jest.fn().mockResolvedValue(createSnapshot()),
      getStateHistory: jest.fn(),
      updateState: jest.fn(),
    };
    const freeChatGraphService = {
      getGraph: jest.fn().mockResolvedValue(graph),
    };
    const chatService = {
      getRecentMessages: jest.fn(),
      replaceSessionMessages: jest.fn(),
    };
    const transcriptService = {
      readEvents: jest.fn(),
      replaceEvents: jest.fn(),
    };
    const sharedMemoryService = {
      clearSession: jest.fn(),
      setWorkspaceState: jest.fn(),
      setDecision: jest.fn(),
    };

    const service = new LangGraphThreadDebugService(
      freeChatGraphService as never,
      chatService as never,
      transcriptService as never,
      sharedMemoryService as never,
    );

    const result = await service.getThreadState('s1');

    expect(graph.getState).toHaveBeenCalledWith({
      configurable: {
        thread_id: 's1',
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        threadId: 's1',
        checkpointId: 'cp-2',
        parentCheckpointId: 'cp-1',
        next: ['run_next_task'],
      }),
    );
  });

  it('returns thread history as normalized snapshots', async () => {
    const historyItems = [
      createSnapshot({
        config: { configurable: { thread_id: 's1', checkpoint_id: 'cp-3' } },
        parentConfig: { configurable: { thread_id: 's1', checkpoint_id: 'cp-2' } },
      }),
      createSnapshot({
        config: { configurable: { thread_id: 's1', checkpoint_id: 'cp-2' } },
        parentConfig: { configurable: { thread_id: 's1', checkpoint_id: 'cp-1' } },
      }),
    ];

    const graph = {
      getState: jest.fn(),
      getStateHistory: jest.fn().mockImplementation(async function* () {
        for (const item of historyItems) {
          yield item;
        }
      }),
      updateState: jest.fn(),
    };
    const service = new LangGraphThreadDebugService(
      {
        getGraph: jest.fn().mockResolvedValue(graph),
      } as never,
      {
        getRecentMessages: jest.fn(),
        replaceSessionMessages: jest.fn(),
      } as never,
      {
        readEvents: jest.fn(),
        replaceEvents: jest.fn(),
      } as never,
      {
        clearSession: jest.fn(),
        setWorkspaceState: jest.fn(),
        setDecision: jest.fn(),
      } as never,
    );

    const result = await service.getThreadHistory('s1', 2);

    expect(graph.getStateHistory).toHaveBeenCalledWith(
      {
        configurable: {
          thread_id: 's1',
        },
      },
      { limit: 2 },
    );
    expect(result.map((item) => item.checkpointId)).toEqual(['cp-3', 'cp-2']);
  });

  it('restores a checkpoint into graph state, chat state, and shared stores', async () => {
    const history = [
      {
        id: 'msg-1',
        sessionId: 's1',
        role: 'user',
        content: 'restore me',
        createdAt: '2026-03-01T23:59:00.000Z',
      },
      {
        id: 'msg-2',
        sessionId: 's1',
        role: 'assistant',
        content: 'done',
        agentId: 'claude-001',
        agentName: 'Claude',
        createdAt: '2026-03-02T00:00:00.000Z',
      },
    ];
    const restoredSnapshot = createSnapshot({
      values: {
        sessionId: 's1',
        history,
        workspaceState: {
          sessionId: 's1',
          updatedAt: '2026-03-02T00:00:00.000Z',
          lastAgentId: 'claude-001',
        },
        summaries: [],
        pendingTasks: [],
        taskFingerprints: [],
        decisions: {
          'claude-001': {
            should: true,
            reason: 'mentioned',
            priority: 100,
            triggerMessageId: 'msg-1',
          },
        },
        agentOutputs: [],
        events: [],
        completedTaskCount: 1,
        maxAgentTurns: 8,
        maxHandoffDepth: 4,
      },
      config: { configurable: { thread_id: 's1', checkpoint_id: 'cp-4' } },
      parentConfig: { configurable: { thread_id: 's1', checkpoint_id: 'cp-3' } },
    });
    const graph = {
      getState: jest.fn().mockResolvedValueOnce(restoredSnapshot).mockResolvedValueOnce(restoredSnapshot),
      getStateHistory: jest.fn(),
      updateState: jest.fn().mockResolvedValue({
        configurable: {
          thread_id: 's1',
          checkpoint_id: 'cp-4',
        },
      }),
    };
    const chatService = {
      getRecentMessages: jest.fn(),
      replaceSessionMessages: jest.fn().mockResolvedValue(undefined),
    };
    const transcriptService = {
      readEvents: jest.fn().mockResolvedValue([
        { type: 'session_created', timestamp: '2026-03-01T23:58:00.000Z' },
        { type: 'message_saved', timestamp: '2026-03-02T00:00:00.000Z' },
        { type: 'message_saved', timestamp: '2026-03-02T00:05:00.000Z' },
      ]),
      replaceEvents: jest.fn().mockResolvedValue(undefined),
    };
    const sharedMemoryService = {
      clearSession: jest.fn().mockResolvedValue(undefined),
      setWorkspaceState: jest.fn().mockResolvedValue(undefined),
      setDecision: jest.fn().mockResolvedValue(undefined),
    };
    const service = new LangGraphThreadDebugService(
      {
        getGraph: jest.fn().mockResolvedValue(graph),
      } as never,
      chatService as never,
      transcriptService as never,
      sharedMemoryService as never,
    );

    const result = await service.restoreThreadState('s1', 'cp-2');

    expect(graph.updateState).toHaveBeenCalledWith(
      {
        configurable: {
          thread_id: 's1',
        },
      },
      expect.objectContaining({
        sessionId: 's1',
      }),
      'hydrate_session_state',
    );
    expect(chatService.replaceSessionMessages).toHaveBeenCalledWith('s1', [
      expect.objectContaining({ id: 'msg-1', content: 'restore me' }),
      expect.objectContaining({ id: 'msg-2', content: 'done' }),
    ]);
    expect(transcriptService.replaceEvents).toHaveBeenCalledWith('s1', [
      expect.objectContaining({ type: 'session_created' }),
      expect.objectContaining({ type: 'message_saved', timestamp: '2026-03-02T00:00:00.000Z' }),
    ]);
    expect(sharedMemoryService.clearSession).toHaveBeenCalledWith('s1');
    expect(sharedMemoryService.setWorkspaceState).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        sessionId: 's1',
        lastAgentId: 'claude-001',
      }),
    );
    expect(sharedMemoryService.setDecision).toHaveBeenCalledWith(
      's1',
      'claude-001',
      expect.objectContaining({
        agentId: 'claude-001',
        should: true,
        reason: 'mentioned',
      }),
    );
    expect(result.checkpointId).toBe('cp-4');
  });
});
