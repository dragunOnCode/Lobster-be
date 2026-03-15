import { ChromaService } from './chroma.service';

jest.mock('chromadb', () => {
  const messagesCollection = {
    add: jest.fn(),
    query: jest.fn(),
    delete: jest.fn(),
  };
  const summariesCollection = {
    add: jest.fn(),
    query: jest.fn(),
    delete: jest.fn(),
  };

  return {
    ChromaClient: jest.fn().mockImplementation(() => ({
      getOrCreateCollection: jest.fn().mockImplementation(({ name }: { name: string }) => {
        if (name === 'messages') {
          return messagesCollection;
        }
        return summariesCollection;
      }),
    })),
    IncludeEnum: {
      Documents: 'documents',
      Metadatas: 'metadatas',
      Distances: 'distances',
    },
  };
});

describe('ChromaService', () => {
  const makeService = () =>
    new ChromaService(
      {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'CHROMA_HOST') return 'localhost';
          if (key === 'CHROMA_PORT') return '8000';
          return undefined;
        }),
      } as any,
      {
        embed: jest.fn().mockResolvedValue([0.1, 0.2]),
        embedBatch: jest.fn().mockResolvedValue([
          [0.1, 0.2],
          [0.2, 0.3],
        ]),
      } as any,
    );

  it('addDocument 应写入 messages 集合', async () => {
    const service = makeService();
    await service.onModuleInit();

    const messagesCollection = (service as any).messagesCollection;
    await service.addDocument({
      id: 'm1',
      content: 'hello',
      metadata: { sessionId: 's1' },
    });

    expect(messagesCollection.add).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: ['m1'],
        documents: ['hello'],
      }),
    );
  });

  it('search 应返回相似度过滤结果', async () => {
    const service = makeService();
    await service.onModuleInit();

    const messagesCollection = (service as any).messagesCollection;
    messagesCollection.query.mockResolvedValue({
      ids: [['m1', 'm2']],
      documents: [['foo', 'bar']],
      metadatas: [[{ sessionId: 's1' }, { sessionId: 's1' }]],
      distances: [[0.1, 0.5]],
    });

    const result = await service.search({
      query: 'foo',
      sessionId: 's1',
      minSimilarity: 0.7,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'm1',
        similarity: 0.9,
      }),
    );
  });
});
