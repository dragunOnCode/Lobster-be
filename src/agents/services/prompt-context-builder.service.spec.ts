import { ConfigService } from '@nestjs/config';
import { PromptContextBuilderService } from './prompt-context-builder.service';

describe('PromptContextBuilderService', () => {
  it('应构建统一上下文模板与预算裁剪', () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new PromptContextBuilderService(config);

    const prompt = service.buildCliPrompt(
      service.buildUserPrompt('@codex 请评审'),
      {
        sessionId: 's1',
        conversationHistory: [
          { id: 'm1', sessionId: 's1', role: 'user', content: '请重点看安全问题', createdAt: new Date() },
          { id: 'm2', sessionId: 's1', role: 'assistant', agentId: 'claude-001', content: '我先给出草案', createdAt: new Date() },
        ],
        semanticContext: [{ id: 'v1', content: '历史安全规范', similarity: 0.9 }],
        summaries: ['已确认：先补测试再重构'],
      },
      { historyLimit: 1, semanticLimit: 1, summaryLimit: 1, tokenBudget: 100, lineMaxChars: 50 },
    );

    expect(prompt).toContain('CURRENT_QUESTION: 请评审');
    expect(prompt).toContain('CONVERSATION_CONTEXT');
    expect(prompt).toContain('SEMANTIC_REFERENCE');
    expect(prompt).toContain('SUMMARY_REFERENCE');
    expect(prompt).toContain('历史安全规范');
    expect(prompt).toContain('已确认：先补测试再重构');
    expect(prompt).not.toContain('请重点看安全问题');
  });

  it('长会话应按预算裁剪并产出观测指标', () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new PromptContextBuilderService(config);

    const conversationHistory = Array.from({ length: 60 }).map((_, index) => ({
      id: `m${index}`,
      sessionId: 's1',
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `第${index + 1}轮消息：${'内容'.repeat(20)}`,
      createdAt: new Date(),
    }));
    const result = service.buildCliPromptWithMetrics(
      '请总结重点',
      {
        sessionId: 's1',
        conversationHistory,
        semanticContext: [{ id: 'v1', content: '相关历史', similarity: 0.88 }],
        summaries: ['历史摘要A', '历史摘要B', '历史摘要C'],
      },
      { historyLimit: 8, semanticLimit: 1, summaryLimit: 2, tokenBudget: 200, lineMaxChars: 80 },
    );

    expect(result.prompt).toContain('CURRENT_QUESTION: 请总结重点');
    expect(result.metrics.historyItems).toBeLessThanOrEqual(8);
    expect(result.metrics.trimmedItems).toBeGreaterThan(0);
    expect(result.metrics.contextChars).toBe(result.prompt.length);
    expect(result.metrics.contextEstimatedTokens).toBeGreaterThan(0);
  });
});
