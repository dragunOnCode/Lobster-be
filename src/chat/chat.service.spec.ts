import { ChatService } from './chat.service';

describe('ChatService', () => {
  it('saveMessage 后应写入向量库', async () => {
    const chromaService = {
      addDocument: jest.fn().mockResolvedValue(undefined),
    } as any;
    const shortTermMemoryService = {
      append: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new ChatService(
      undefined,
      undefined,
      undefined,
      shortTermMemoryService,
      chromaService,
    );

    const message = await service.saveMessage({
      sessionId: 'session-1',
      role: 'user',
      content: 'hello vector',
      userId: 'u1',
    });

    expect(chromaService.addDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: message.id,
        content: 'hello vector',
        metadata: expect.objectContaining({
          sessionId: 'session-1',
          role: 'user',
        }),
      }),
    );
  });

  it('向量写入失败时不应影响 saveMessage', async () => {
    const chromaService = {
      addDocument: jest.fn().mockRejectedValue(new Error('chroma down')),
    } as any;
    const service = new ChatService(undefined, undefined, undefined, undefined, chromaService);

    await expect(
      service.saveMessage({
        sessionId: 'session-2',
        role: 'assistant',
        content: 'fallback path',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        sessionId: 'session-2',
        content: 'fallback path',
      }),
    );
  });
});
