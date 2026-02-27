import { ConfigService } from '@nestjs/config';
import { AgentStatus } from '../interfaces';
import { ClaudeAdapter } from './claude.adapter';
import { CliRunnerService } from '../services/cli-runner.service';
import { SharedMemoryService } from '../../memory/services/shared-memory.service';

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;
  let cliRunner: { run: jest.Mock };
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let contextBuilder: { buildContext: jest.Mock };
  let sharedMemoryService: {
    getAgentThreadBinding: jest.Mock;
    setAgentThreadBinding: jest.Mock;
  };

  beforeEach(() => {
    cliRunner = {
      run: jest.fn(),
    };
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    };
    contextBuilder = {
      buildContext: jest.fn(),
    };
    sharedMemoryService = {
      getAgentThreadBinding: jest.fn().mockResolvedValue(null),
      setAgentThreadBinding: jest.fn().mockResolvedValue(undefined),
    };

    adapter = new ClaudeAdapter(
      cliRunner as unknown as CliRunnerService,
      configService as unknown as ConfigService,
      sharedMemoryService as unknown as SharedMemoryService,
      contextBuilder as any,
    );
  });

  it('当缺少 CLAUDE_TIMEOUT_MS 时应抛错并保持 OFFLINE', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      throw new Error(`Missing required key: ${key}`);
    });
    configService.get.mockReturnValue(undefined);

    await expect(adapter.generate('hello', { sessionId: 's1' })).rejects.toThrow('CLAUDE_TIMEOUT_MS');
    expect(adapter.getStatus()).toBe(AgentStatus.OFFLINE);
  });

  it('generate 成功时应返回标准响应', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        CLAUDE_TIMEOUT_MS: '60000',
      };
      return values[key];
    });
    configService.get.mockImplementation((key: string) => {
      if (key === 'CLAUDE_CLI_PATH') {
        return 'claude';
      }
      return undefined;
    });
    cliRunner.run.mockResolvedValue({
      stdout: JSON.stringify({
        content: 'test response',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
        },
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await adapter.generate('hello', { sessionId: 's1' });

    expect(result.content).toBe('test response');
    expect(result.tokenUsage).toEqual({ prompt: 10, completion: 20, total: 30 });
    expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
  });

  it('healthCheck 失败时应返回 false', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'CLAUDE_CLI_PATH') {
        return 'claude';
      }
      return undefined;
    });
    cliRunner.run.mockRejectedValue(new Error('cli error'));

    await expect(adapter.healthCheck()).resolves.toBe(false);
  });

  it('streamGenerate 应产出 generate 返回内容', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        CLAUDE_TIMEOUT_MS: '60000',
      };
      return values[key];
    });
    configService.get.mockImplementation((key: string) => {
      if (key === 'CLAUDE_CLI_PATH') {
        return 'claude';
      }
      return undefined;
    });
    cliRunner.run.mockResolvedValue({
      stdout: JSON.stringify({ content: 'Hello' }),
      stderr: '',
      exitCode: 0,
    });

    const deltas: string[] = [];
    for await (const chunk of adapter.streamGenerate('hello', { sessionId: 's1' })) {
      deltas.push(chunk);
    }

    expect(deltas).toEqual(['Hello']);
  });

  it('generate 应注入语义检索上下文到用户提示词', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        CLAUDE_TIMEOUT_MS: '60000',
      };
      return values[key];
    });
    configService.get.mockImplementation((key: string) => {
      if (key === 'CLAUDE_CLI_PATH') {
        return 'claude';
      }
      return undefined;
    });
    contextBuilder.buildContext.mockResolvedValue({
      sessionId: 's1',
      semanticContext: [
        {
          id: 'v1',
          content: '历史相关内容',
          similarity: 0.9,
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
      summaries: ['摘要信息'],
    });
    cliRunner.run.mockResolvedValue({
      stdout: JSON.stringify({ content: 'ok' }),
      stderr: '',
      exitCode: 0,
    });

    await adapter.generate('当前问题', { sessionId: 's1' });
    const call = cliRunner.run.mock.calls[0][0] as { args: string[] };
    const cliPrompt = call.args[3];
    expect(cliPrompt).toContain('语义相关的历史上下文');
    expect(cliPrompt).toContain('历史相关内容');
  });

  it('generate 在 token 预算不足时应截断历史消息', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        CLAUDE_TIMEOUT_MS: '60000',
      };
      return values[key];
    });
    configService.get.mockImplementation((key: string) => {
      if (key === 'CLAUDE_CLI_PATH') {
        return 'claude';
      }
      if (key === 'CLAUDE_CONTEXT_TOKEN_BUDGET') {
        return '60';
      }
      return undefined;
    });
    contextBuilder.buildContext.mockResolvedValue({
      sessionId: 's1',
      conversationHistory: [
        { id: 'h1', sessionId: 's1', role: 'user', content: '这是很长很长的历史消息，应该被截断'.repeat(10) },
        { id: 'h2', sessionId: 's1', role: 'assistant', content: '这是历史回答，应该被截断'.repeat(10) },
      ],
    });
    cliRunner.run.mockResolvedValue({
      stdout: JSON.stringify({ content: 'ok' }),
      stderr: '',
      exitCode: 0,
    });

    await adapter.generate('当前问题', { sessionId: 's1' });
    const call = cliRunner.run.mock.calls[0][0] as { args: string[] };
    const cliPrompt = call.args[3];
    expect(cliPrompt).toContain('当前问题');
    expect(cliPrompt).not.toContain('这是很长很长的历史消息');
  });

  it('存在 session 绑定时应使用 -r 参数续聊', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        CLAUDE_TIMEOUT_MS: '60000',
      };
      return values[key];
    });
    configService.get.mockImplementation((key: string) => {
      if (key === 'CLAUDE_CLI_PATH') {
        return 'claude';
      }
      return undefined;
    });
    sharedMemoryService.getAgentThreadBinding.mockResolvedValue({
      sessionId: 's1',
      agentId: 'claude-001',
      threadId: 'sess-old',
      updatedAt: new Date().toISOString(),
    });
    cliRunner.run.mockResolvedValue({
      stdout: JSON.stringify({ content: 'ok', session_id: 'sess-new' }),
      stderr: '',
      exitCode: 0,
    });

    await adapter.generate('hello', { sessionId: 's1' });
    const call = cliRunner.run.mock.calls[0][0] as { args: string[] };
    expect(call.args[0]).toBe('-r');
    expect(call.args[1]).toBe('sess-old');
    expect(sharedMemoryService.setAgentThreadBinding).toHaveBeenCalledWith('s1', 'claude-001', 'sess-new');
  });
});
