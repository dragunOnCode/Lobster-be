import { ConfigService } from '@nestjs/config';
import { GeminiAdapter } from './gemini.adapter';
import { CliRunnerService } from '../services/cli-runner.service';
import { PromptContextBuilderService } from '../services/prompt-context-builder.service';

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;
  let cliRunner: { run: jest.Mock };
  let configService: { getOrThrow: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    cliRunner = { run: jest.fn() };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          GEMINI_CLI_PATH: 'gemini',
          GEMINI_TIMEOUT_MS: '60000',
        };
        return values[key];
      }),
      get: jest.fn().mockReturnValue(undefined),
    };

    const promptContextBuilder = new PromptContextBuilderService({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);

    adapter = new GeminiAdapter(
      cliRunner as unknown as CliRunnerService,
      configService as unknown as ConfigService,
      promptContextBuilder,
    );
  });

  it('parses CLI output and injects unified prompt sections', async () => {
    const context = {
      sessionId: 's1',
      semanticContext: [{ id: 'v1', content: '品牌风格：简洁明亮', similarity: 0.91 }],
      summaries: ['之前讨论：登录页突出主按钮'],
      conversationHistory: [
        { id: 'm1', sessionId: 's1', role: 'assistant' as const, content: '建议采用浅色系', agentId: 'gemini-001' },
      ],
    };
    cliRunner.run.mockResolvedValue({
      stdout: '{"response":"gemini result","style":"creative","session_id":"g-session-1"}',
      stderr: '',
      exitCode: 0,
    });

    const result = await adapter.generate('设计一个登录页面', context);
    expect(result.content).toBe('gemini result');
    expect(result.metadata).toEqual(expect.objectContaining({ style: 'creative', session_id: 'g-session-1' }));

    const call = cliRunner.run.mock.calls[0][0] as { args: string[] };
    expect(call.args[1]).toContain('## user_intent');
    expect(call.args[1]).toContain('设计一个登录页面');
    expect(call.args[1]).toContain('## conversation');
    expect(call.args[1]).toContain('品牌风格：简洁明亮');
  });

  it('should respond on direct @Gemini mention', async () => {
    const decision = await adapter.shouldRespond(
      { id: 'm1', sessionId: 's1', role: 'user', content: '@Gemini 给点创意建议' },
      { sessionId: 's1' },
    );
    expect(decision).toEqual(expect.objectContaining({ should: true, priority: 'high' }));
  });

  it('should respond on design keywords', async () => {
    const decision = await adapter.shouldRespond(
      { id: 'm1', sessionId: 's1', role: 'user', content: '这个 UI 交互需要优化' },
      { sessionId: 's1' },
    );
    expect(decision).toEqual(expect.objectContaining({ should: true, priority: 'medium' }));
  });

  it('should not respond when no rule matched', async () => {
    const decision = await adapter.shouldRespond(
      { id: 'm1', sessionId: 's1', role: 'user', content: '请帮我查数据库索引' },
      { sessionId: 's1' },
    );
    expect(decision.should).toBe(false);
  });
});
