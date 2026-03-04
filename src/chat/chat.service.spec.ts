import { ChatService } from './chat.service';

describe('ChatService', () => {
  it('restores session history from workspace transcripts when memory is empty', async () => {
    const workspaceService = {
      readTranscript: jest.fn().mockResolvedValue([
        {
          type: 'session_created',
          sessionId: 'demo-session-2',
          timestamp: '2026-03-01T09:42:08.546Z',
        },
        {
          type: 'message_saved',
          messageId: 'msg-user-1',
          role: 'user',
          userId: 'demo-user',
          content: 'hello from transcript',
          timestamp: '2026-03-01T09:42:08.546Z',
        },
        {
          type: 'message_saved',
          role: 'assistant',
          agentId: 'claude-001',
          contentPreview: 'fallback preview content',
          timestamp: '2026-03-01T09:42:27.573Z',
        },
      ]),
    } as any;
    const shortTermMemoryService = {
      get: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new ChatService(
      undefined,
      undefined,
      workspaceService,
      shortTermMemoryService,
      undefined,
      undefined,
    );

    await expect(service.getRecentMessages('demo-session-2', 20)).resolves.toEqual([
      expect.objectContaining({
        id: 'msg-user-1',
        role: 'user',
        content: 'hello from transcript',
      }),
      expect.objectContaining({
        id: 'transcript_demo-session-2_2',
        role: 'assistant',
        content: 'fallback preview content',
      }),
    ]);
    expect(shortTermMemoryService.save).toHaveBeenCalledWith(
      'demo-session-2',
      expect.arrayContaining([
        expect.objectContaining({ id: 'msg-user-1' }),
        expect.objectContaining({ content: 'fallback preview content' }),
      ]),
    );
  });

  it('triggers summary generation after saveMessage', async () => {
    const conversationSummaryService = {
      maybeGenerate: jest.fn().mockResolvedValue(undefined),
    } as any;
    const shortTermMemoryService = {
      append: jest.fn().mockResolvedValue([]),
    } as any;
    const service = new ChatService(
      undefined,
      undefined,
      undefined,
      shortTermMemoryService,
      undefined,
      conversationSummaryService,
    );

    await service.saveMessage({
      sessionId: 'session-summary',
      role: 'user',
      content: 'summarize the current progress',
      userId: 'u1',
    });

    expect(conversationSummaryService.maybeGenerate).toHaveBeenCalledWith('session-summary');
  });

  it('indexes messages into the vector store after saveMessage', async () => {
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
      undefined,
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

  it('does not fail saveMessage when vector indexing fails', async () => {
    const chromaService = {
      addDocument: jest.fn().mockRejectedValue(new Error('chroma down')),
    } as any;
    const service = new ChatService(undefined, undefined, undefined, undefined, chromaService, undefined);

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

  it('replaceSessionMessages refreshes short-term memory and vector indexes', async () => {
    const shortTermMemoryService = {
      append: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue([]),
    } as any;
    const chromaService = {
      addDocument: jest.fn(),
      addDocuments: jest.fn().mockResolvedValue(undefined),
      deleteBySessionId: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new ChatService(
      undefined,
      undefined,
      undefined,
      shortTermMemoryService,
      chromaService,
      undefined,
    );

    await service.replaceSessionMessages('session-restore', [
      {
        id: 'msg-1',
        sessionId: 'session-restore',
        role: 'user',
        content: 'first',
        createdAt: new Date('2026-03-02T00:00:00.000Z'),
      },
      {
        id: 'msg-2',
        sessionId: 'session-restore',
        role: 'assistant',
        content: 'second',
        agentId: 'claude-001',
        agentName: 'Claude',
        createdAt: new Date('2026-03-02T00:01:00.000Z'),
      },
    ]);

    await expect(service.getRecentMessages('session-restore', 10)).resolves.toEqual([
      expect.objectContaining({ id: 'msg-1', content: 'first' }),
      expect.objectContaining({ id: 'msg-2', content: 'second' }),
    ]);
    expect(shortTermMemoryService.save).toHaveBeenCalledWith(
      'session-restore',
      expect.arrayContaining([
        expect.objectContaining({ id: 'msg-1' }),
        expect.objectContaining({ id: 'msg-2' }),
      ]),
    );
    expect(chromaService.deleteBySessionId).toHaveBeenCalledWith('session-restore');
    expect(chromaService.addDocuments).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'msg-1', content: 'first' }),
        expect.objectContaining({ id: 'msg-2', content: 'second' }),
      ]),
    );
  });

  it('writes full message content to workspace transcripts when saving', async () => {
    const workspaceService = {
      initializeSession: jest.fn().mockResolvedValue(undefined),
      appendTranscript: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new ChatService(undefined, undefined, workspaceService, undefined, undefined, undefined);

    const message = await service.saveMessage({
      sessionId: 'session-transcript',
      role: 'assistant',
      content: 'full transcript body',
      agentId: 'claude-001',
      agentName: 'Claude',
    });

    expect(workspaceService.appendTranscript).toHaveBeenCalledWith(
      'session-transcript',
      expect.objectContaining({
        type: 'message_saved',
        messageId: message.id,
        sessionId: 'session-transcript',
        role: 'assistant',
        agentId: 'claude-001',
        agentName: 'Claude',
        content: 'full transcript body',
        contentPreview: 'full transcript body',
      }),
    );
  });
});
