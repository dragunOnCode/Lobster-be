import { ConfigService } from '@nestjs/config';
import { GeminiAdapter } from './gemini.adapter';
import { CliRunnerService } from '../services/cli-runner.service';

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;
  let cliRunner: { run: jest.Mock };
  let configService: { getOrThrow: jest.Mock };

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
    };

    adapter = new GeminiAdapter(cliRunner as unknown as CliRunnerService, configService as unknown as ConfigService);
  });

  it('generate 应解析 CLI 输出', async () => {
    cliRunner.run.mockResolvedValue({
      stdout: '{"content":"gemini result","style":"creative"}',
      stderr: '',
      exitCode: 0,
    });

    const result = await adapter.generate('设计一个登录页面', { sessionId: 's1' });
    expect(result.content).toBe('gemini result');
    expect(result.metadata).toEqual(expect.objectContaining({ style: 'creative' }));
  });

  it('shouldRespond 命中 @Gemini', async () => {
    const decision = await adapter.shouldRespond(
      { id: 'm1', sessionId: 's1', role: 'user', content: '@Gemini 给点创意建议' },
      { sessionId: 's1' },
    );
    expect(decision).toEqual(expect.objectContaining({ should: true, priority: 'high' }));
  });

  it('shouldRespond 命中设计关键词', async () => {
    const decision = await adapter.shouldRespond(
      { id: 'm1', sessionId: 's1', role: 'user', content: '这个 UI 交互需要优化' },
      { sessionId: 's1' },
    );
    expect(decision).toEqual(expect.objectContaining({ should: true, priority: 'medium' }));
  });

  it('shouldRespond 未命中规则应返回 false', async () => {
    const decision = await adapter.shouldRespond(
      { id: 'm1', sessionId: 's1', role: 'user', content: '请帮我查数据库索引' },
      { sessionId: 's1' },
    );
    expect(decision.should).toBe(false);
  });
});
