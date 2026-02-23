import { EmbeddingService } from './embedding.service';

describe('EmbeddingService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('默认 provider=ollama 时 embed 应走 ollama 接口', async () => {
    const service = new EmbeddingService({
      getOrThrow: jest.fn(),
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'EMBEDDING_PROVIDER') return 'ollama';
        if (key === 'OLLAMA_BASE_URL') return 'http://localhost:11434';
        if (key === 'OLLAMA_EMBEDDING_MODEL') return 'nomic-embed-text';
        return undefined;
      }),
    } as any);

    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
    } as any);

    await expect(service.embed('hello')).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('embedBatch 在 openai provider 下应按批次调用', async () => {
    const service = new EmbeddingService({
      get: jest
        .fn()
        .mockImplementation((key: string) => {
          if (key === 'EMBEDDING_PROVIDER') return 'openai';
          if (key === 'OPENAI_API_KEY') return 'test-key';
          if (key === 'EMBEDDING_BATCH_SIZE') return '2';
          return undefined;
        }),
      getOrThrow: jest.fn(),
    } as any);

    const create = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ embedding: [1] }, { embedding: [2] }] })
      .mockResolvedValueOnce({ data: [{ embedding: [3] }] });

    (service as any).openaiClient = {
      embeddings: { create },
    };

    await expect(service.embedBatch(['a', 'b', 'c'])).resolves.toEqual([[1], [2], [3]]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('openai provider 无 key 时应回退到 ollama', async () => {
    const service = new EmbeddingService({
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'EMBEDDING_PROVIDER') return 'openai';
        if (key === 'OLLAMA_BASE_URL') return 'http://localhost:11434';
        return undefined;
      }),
      getOrThrow: jest.fn(),
    } as any);

    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ embeddings: [[9, 8, 7]] }),
    } as any);

    await expect(service.embed('fallback')).resolves.toEqual([9, 8, 7]);
  });
});
