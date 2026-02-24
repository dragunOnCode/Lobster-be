import { ConfigService } from '@nestjs/config';
import { GeminiAdapter } from './gemini.adapter';
import { CliRunnerService } from '../services/cli-runner.service';
import { SharedMemoryService } from '../../memory/services/shared-memory.service';

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;
  let cliRunner: { run: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let sharedMemoryService: { getAgentThreadBinding: jest.Mock; setAgentThreadBinding: jest.Mock };

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
    sharedMemoryService = {
      getAgentThreadBinding: jest.fn().mockResolvedValue(null),
      setAgentThreadBinding: jest.fn().mockResolvedValue(undefined),
    };

    adapter = new GeminiAdapter(
      cliRunner as unknown as CliRunnerService,
      configService as unknown as ConfigService,
      sharedMemoryService as unknown as SharedMemoryService,
    );
  });

  it('generate 应解析 CLI 输出', async () => {
    cliRunner.run.mockResolvedValue({
      stdout: '{"response":"gemini result","style":"creative","session_id":"g-session-1"}',
      stderr: '',
      exitCode: 0,
    });

    const result = await adapter.generate('设计一个登录页面', { sessionId: 's1' });
    expect(result.content).toBe('gemini result');
    expect(result.metadata).toEqual(expect.objectContaining({ style: 'creative', geminiSessionId: 'g-session-1' }));
  });

  it('generate 应在已有会话时使用 -r 续聊', async () => {
    sharedMemoryService.getAgentThreadBinding.mockResolvedValueOnce({
      sessionId: 's1',
      agentId: 'gemini-001',
      threadId: 'g-session-1',
      updatedAt: new Date().toISOString(),
    });
    cliRunner.run.mockResolvedValue({
      stdout: '{"response":"continued","session_id":"g-session-1"}',
      stderr: '',
      exitCode: 0,
    });

    await adapter.generate('继续', { sessionId: 's1' });
    expect(cliRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'gemini',
        args: ['-r', 'g-session-1', '-p', '继续', '--output-format', 'json'],
      }),
    );
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
