import { ConfigService } from '@nestjs/config';
import { ConversationSummaryService } from './conversation-summary.service';

function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

describe('ConversationSummaryService', () => {
  it('达到阈值时应生成摘要并写入共享状态', async () => {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        const values: Record<string, string> = {
          CONVERSATION_SUMMARY_ENABLED: 'true',
          CONVERSATION_SUMMARY_TRIGGER_MESSAGES: '3',
          CONVERSATION_SUMMARY_MIN_INTERVAL_MESSAGES: '2',
          CONVERSATION_SUMMARY_LOOKBACK_MESSAGES: '5',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const shortTermMemoryService = {
      get: jest.fn().mockResolvedValue([
        { id: 'm1', sessionId: 's1', role: 'user', content: '请审查登录逻辑', createdAt: new Date().toISOString() },
        { id: 'm2', sessionId: 's1', role: 'assistant', content: '建议增加限流和日志', createdAt: new Date().toISOString() },
        { id: 'm3', sessionId: 's1', role: 'user', content: '下一步帮我补测试', createdAt: new Date().toISOString() },
      ]),
    } as any;
    const sharedMemoryService = {
      getWorkspaceState: jest.fn().mockResolvedValue({ sessionId: 's1', updatedAt: new Date().toISOString() }),
      setWorkspaceState: jest.fn().mockResolvedValue(undefined),
    } as any;
    const chromaService = {
      addDocument: jest.fn().mockResolvedValue(undefined),
    } as any;

    const service = new ConversationSummaryService(configService, shortTermMemoryService, sharedMemoryService, chromaService);
    await service.maybeGenerate('s1');

    expect(sharedMemoryService.setWorkspaceState).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        sessionId: 's1',
        autoSummary: expect.stringContaining('会话自动摘要'),
        autoSummaryMessageCount: 3,
      }),
    );
    expect(chromaService.addDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('会话自动摘要'),
        metadata: expect.objectContaining({ sessionId: 's1', source: 'auto_summary' }),
      }),
      'summaries',
    );
  });

  it('未达到阈值时不应生成摘要', async () => {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        const values: Record<string, string> = {
          CONVERSATION_SUMMARY_ENABLED: 'true',
          CONVERSATION_SUMMARY_TRIGGER_MESSAGES: '5',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const shortTermMemoryService = {
      get: jest.fn().mockResolvedValue([{ id: 'm1', sessionId: 's1', role: 'user', content: 'hello', createdAt: '' }]),
    } as any;
    const sharedMemoryService = {
      getWorkspaceState: jest.fn(),
      setWorkspaceState: jest.fn(),
    } as any;

    const service = new ConversationSummaryService(configService, shortTermMemoryService, sharedMemoryService, undefined as any);
    await service.maybeGenerate('s1');

    expect(sharedMemoryService.setWorkspaceState).not.toHaveBeenCalled();
  });

  it('摘要未变化时应跳过 summaries 向量入库', async () => {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        const values: Record<string, string> = {
          CONVERSATION_SUMMARY_ENABLED: 'true',
          CONVERSATION_SUMMARY_TRIGGER_MESSAGES: '3',
          CONVERSATION_SUMMARY_MIN_INTERVAL_MESSAGES: '1',
          CONVERSATION_SUMMARY_LOOKBACK_MESSAGES: '5',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const shortTermMemoryService = {
      get: jest.fn().mockResolvedValue([
        { id: 'm1', sessionId: 's1', role: 'user', content: '请审查登录逻辑', createdAt: new Date().toISOString() },
        { id: 'm2', sessionId: 's1', role: 'assistant', content: '建议增加限流和日志', createdAt: new Date().toISOString() },
        { id: 'm3', sessionId: 's1', role: 'user', content: '下一步帮我补测试', createdAt: new Date().toISOString() },
      ]),
    } as any;
    const expectedSummary = [
      '会话自动摘要（系统生成）',
      '- 近期用户关注：请审查登录逻辑 | 下一步帮我补测试',
      '- 近期Agent结论：建议增加限流和日志',
      '- 待办线索：请审查登录逻辑 | 下一步帮我补测试',
    ].join('\n');
    const sharedMemoryService = {
      getWorkspaceState: jest.fn().mockResolvedValue({
        sessionId: 's1',
        updatedAt: new Date().toISOString(),
        autoSummaryMessageCount: 0,
        autoSummaryFingerprint: fingerprint(expectedSummary),
      }),
      setWorkspaceState: jest.fn().mockResolvedValue(undefined),
    } as any;
    const chromaService = {
      addDocument: jest.fn().mockResolvedValue(undefined),
    } as any;

    const service = new ConversationSummaryService(configService, shortTermMemoryService, sharedMemoryService, chromaService);
    await service.maybeGenerate('s1');

    expect(sharedMemoryService.setWorkspaceState).toHaveBeenCalled();
    expect(chromaService.addDocument).not.toHaveBeenCalled();
  });
});
