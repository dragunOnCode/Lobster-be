import { ContextBuilderService } from './context-builder.service';

describe('ContextBuilderService', () => {
  it('prefers semantic retrieval for conversation history by default', async () => {
    const service = new ContextBuilderService(
      {
        search: jest.fn().mockImplementation((params: { collection?: 'messages' | 'summaries' }) => {
          if (params.collection === 'messages') {
            return Promise.resolve([
              {
                id: 'v1',
                content: 'historical semantic context',
                metadata: { role: 'user', createdAt: '2026-01-01T00:00:00.000Z' },
                similarity: 0.91,
              },
            ]);
          }
          return Promise.resolve([]);
        }),
      } as any,
      {
        get: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            sessionId: 's1',
            role: 'assistant',
            content: 'recent memory content',
            createdAt: '2026-01-01T01:00:00.000Z',
          },
        ]),
      } as any,
      {
        getWorkspaceState: jest.fn().mockResolvedValue({ sessionId: 's1', updatedAt: '2026-01-01T02:00:00.000Z' }),
      } as any,
      {
        get: jest.fn().mockReturnValue(undefined),
      } as any,
    );

    const context = await service.buildContext('s1', 'please recall the previous architecture discussion');

    expect(context.semanticContext).toHaveLength(1);
    expect(context.conversationHistory?.[0].id).toBe('v1');
    expect(context.conversationHistory?.[0].content).toBe('historical semantic context');
  });

  it('falls back to short-term memory when semantic retrieval is empty', async () => {
    const service = new ContextBuilderService(
      {
        search: jest.fn().mockResolvedValue([]),
      } as any,
      {
        get: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            sessionId: 's1',
            role: 'assistant',
            content: 'recent short-term memory',
            createdAt: '2026-01-01T01:00:00.000Z',
          },
        ]),
      } as any,
      {
        getWorkspaceState: jest.fn().mockResolvedValue(null),
      } as any,
      {
        get: jest.fn().mockReturnValue(undefined),
      } as any,
    );

    const context = await service.buildContext('s1', 'a brand new question');
    expect(context.semanticContext).toEqual([]);
    expect(context.conversationHistory?.[0].id).toBe('m1');
  });

  it('can disable conversation history and workspace loading for graph-owned context', async () => {
    const sharedMemory = {
      getWorkspaceState: jest.fn().mockResolvedValue({ sessionId: 's1', updatedAt: '2026-01-01T02:00:00.000Z' }),
    };
    const service = new ContextBuilderService(
      {
        search: jest.fn().mockImplementation((params: { collection?: 'messages' | 'summaries' }) => {
          if (params.collection === 'summaries') {
            return Promise.resolve([
              {
                id: 'sum-1',
                content: 'summary from vector store',
                metadata: {},
                similarity: 0.88,
              },
            ]);
          }
          return Promise.resolve([
            {
              id: 'v1',
              content: 'semantic retrieval content',
              metadata: { role: 'assistant', createdAt: '2026-01-01T00:00:00.000Z' },
              similarity: 0.91,
            },
          ]);
        }),
      } as any,
      {
        get: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            sessionId: 's1',
            role: 'assistant',
            content: 'short-term memory content',
            createdAt: '2026-01-01T01:00:00.000Z',
          },
        ]),
      } as any,
      sharedMemory as any,
      {
        get: jest.fn().mockReturnValue(undefined),
      } as any,
    );

    const context = await service.buildContext('s1', 'use graph-owned context', undefined, {
      conversationHistorySource: 'none',
      includeWorkspaceState: false,
    });

    expect(context.conversationHistory).toEqual([]);
    expect(context.semanticContext).toEqual([
      expect.objectContaining({
        id: 'v1',
        content: 'semantic retrieval content',
      }),
    ]);
    expect(context.summaries).toEqual(['summary from vector store']);
    expect(context.sharedMemory).toBeUndefined();
    expect(sharedMemory.getWorkspaceState).not.toHaveBeenCalled();
  });
});
