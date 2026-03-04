import { ConfigService } from '@nestjs/config';
import { CodexAdapter } from './codex.adapter';
import { CliRunnerService } from '../services/cli-runner.service';

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;
  let cliRunner: { run: jest.Mock };
  let configService: { getOrThrow: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    cliRunner = { run: jest.fn() };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          CODEX_CLI_PATH: 'codex-cli',
          CODEX_TIMEOUT_MS: '60000',
        };
        return values[key];
      }),
      get: jest.fn().mockReturnValue(undefined),
    };

    adapter = new CodexAdapter(cliRunner as unknown as CliRunnerService, configService as unknown as ConfigService);
  });

  it('generate 应解析 CLI 输出', async () => {
    const context = {
      sessionId: 's1',
      semanticContext: [{ id: 'v1', content: '历史代码规范', similarity: 0.88 }],
      summaries: ['之前约定：优先补齐测试'],
      conversationHistory: [
        { id: 'm1', sessionId: 's1', role: 'assistant' as const, content: '请先补测试', agentId: 'claude-001' },
      ],
    };
    cliRunner.run.mockResolvedValue({
      stdout: '{"content":"codex result","tokens":123}',
      stderr: '',
      exitCode: 0,
    });

    const result = await adapter.generate('please review', context);
    expect(result.content).toBe('codex result');
    expect(result.metadata).toEqual(expect.objectContaining({ tokens: 123 }));
    const call = cliRunner.run.mock.calls[0][0] as { input: string };
    expect(call.input).toContain('CURRENT_QUESTION: please review');
    expect(call.input).toContain('语义相关历史');
    expect(call.input).toContain('历史代码规范');
  });

  it('shouldRespond 命中 @Codex', async () => {
    const decision = await adapter.shouldRespond(
      { id: 'm1', sessionId: 's1', role: 'user', content: '@Codex 帮我看看' },
      { sessionId: 's1' },
    );
    expect(decision).toEqual(expect.objectContaining({ should: true, priority: 'high' }));
  });

  it('shouldRespond 命中关键词', async () => {
    const decision = await adapter.shouldRespond(
      { id: 'm1', sessionId: 's1', role: 'user', content: '这段代码有 bug 吗？' },
      { sessionId: 's1' },
    );
    expect(decision).toEqual(expect.objectContaining({ should: true, priority: 'medium' }));
  });

  it('shouldRespond 命中工作空间变更', async () => {
    const decision = await adapter.shouldRespond(
      { id: 'm1', sessionId: 's1', role: 'user', content: '看看这个提交' },
      { sessionId: 's1', workspaceChange: { type: 'file_updated', path: 'src/a.ts' } },
    );
    expect(decision).toEqual(expect.objectContaining({ should: true, priority: 'medium' }));
  });

  it('shouldRespond 未命中规则应返回 false', async () => {
    const decision = await adapter.shouldRespond(
      { id: 'm1', sessionId: 's1', role: 'user', content: '今天天气不错' },
      { sessionId: 's1' },
    );
    expect(decision.should).toBe(false);
  });
});
