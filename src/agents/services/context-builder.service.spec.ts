import { ContextBuilderService } from './context-builder.service';

describe('ContextBuilderService', () => {
  it('应优先返回语义检索结果作为上下文', async () => {
    const service = new ContextBuilderService(
      {
        search: jest.fn().mockImplementation((params: { collection?: 'messages' | 'summaries' }) => {
          if (params.collection === 'messages') {
            return Promise.resolve([
              {
                id: 'v1',
                content: '历史相关内容',
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
            content: '最近消息',
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

    const context = await service.buildContext('s1', '请回顾之前讨论的架构');

    expect(context.semanticContext).toHaveLength(1);
    expect(context.conversationHistory?.[0].id).toBe('v1');
    expect(context.conversationHistory?.[0].content).toBe('历史相关内容');
  });

  it('语义检索为空时应回退到短期记忆', async () => {
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
            content: '最近短期记忆',
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

    const context = await service.buildContext('s1', '问一个新问题');
    expect(context.semanticContext).toEqual([]);
    expect(context.conversationHistory?.[0].id).toBe('m1');
  });
});
