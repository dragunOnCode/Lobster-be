import { ConfigService } from '@nestjs/config';
import { AgentStatus } from '../interfaces';
import { ClaudeAdapter } from './claude.adapter';
import { CliRunnerService } from '../services/cli-runner.service';

async function* streamChunks(chunks: string[]) {
  for (const chunk of chunks) {
    yield { stream: 'stdout' as const, chunk };
  }
}

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;
  let cliRunner: { run: jest.Mock; stream: jest.Mock };
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };

  beforeEach(() => {
    cliRunner = {
      run: jest.fn(),
      stream: jest.fn(),
    };
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    };

    adapter = new ClaudeAdapter(cliRunner as unknown as CliRunnerService, configService as unknown as ConfigService);
  });

  it('throws when CLAUDE_TIMEOUT_MS is missing and keeps status OFFLINE', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      throw new Error(`Missing required key: ${key}`);
    });
    configService.get.mockReturnValue(undefined);

    await expect(adapter.generate('hello', { sessionId: 's1' })).rejects.toThrow('CLAUDE_TIMEOUT_MS');
    expect(adapter.getStatus()).toBe(AgentStatus.OFFLINE);
  });

  it('returns a normalized response on generate success', async () => {
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

  it('returns false when healthCheck fails', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'CLAUDE_CLI_PATH') {
        return 'claude';
      }
      return undefined;
    });
    cliRunner.run.mockRejectedValue(new Error('cli error'));

    await expect(adapter.healthCheck()).resolves.toBe(false);
  });

  it('streamGenerate yields incremental deltas from stream-json output', async () => {
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
    cliRunner.stream.mockImplementation(() =>
      streamChunks([
        '{"type":"content_block_delta","delta":{"text":"Hel"}}\n',
        '{"type":"content_block_delta","delta":{"text":"lo"}}\n',
        '{"type":"result","result":"Hello"}\n',
      ]),
    );

    const deltas: string[] = [];
    for await (const chunk of adapter.streamGenerate('hello', { sessionId: 's1' })) {
      deltas.push(chunk);
    }

    expect(deltas).toEqual(['Hel', 'lo']);
    expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
  });

  it('injects semantic context into the Claude prompt', async () => {
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
      stdout: JSON.stringify({ content: 'ok' }),
      stderr: '',
      exitCode: 0,
    });

    await adapter.generate('current question', {
      sessionId: 's1',
      semanticContext: [
        {
          id: 'v1',
          content: 'historical semantic context',
          similarity: 0.9,
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
      summaries: ['summary text'],
    });
    const call = cliRunner.run.mock.calls[0][0] as { args: string[] };
    const promptIndex = call.args.findIndex((arg) => arg === '-p');
    const cliPrompt = call.args[promptIndex + 1];
    expect(cliPrompt).toContain('historical semantic context');
  });

  it('injects conversation history into the Claude prompt', async () => {
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
    cliRunner.run.mockResolvedValue({
      stdout: JSON.stringify({ content: 'ok' }),
      stderr: '',
      exitCode: 0,
    });

    await adapter.generate('current question', {
      sessionId: 's1',
      conversationHistory: [
        { id: 'h1', sessionId: 's1', role: 'user', content: 'long historical user message '.repeat(10) },
        { id: 'h2', sessionId: 's1', role: 'assistant', content: 'historical assistant answer '.repeat(10) },
      ],
    });
    const call = cliRunner.run.mock.calls[0][0] as { args: string[] };
    const promptIndex = call.args.findIndex((arg) => arg === '-p');
    const cliPrompt = call.args[promptIndex + 1];
    expect(cliPrompt).toContain('CURRENT_QUESTION');
    expect(cliPrompt).toContain('CONVERSATION_CONTEXT');
    expect(cliPrompt).toContain('long historical user message');
  });
});
