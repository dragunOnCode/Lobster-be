import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AgentStatus } from '../interfaces';
import { ClaudeAdapter } from './claude.adapter';

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;
  let httpService: { post: jest.Mock };
  let configService: { get: jest.Mock; getOrThrow: jest.Mock };
  let contextBuilder: { buildContext: jest.Mock };

  beforeEach(() => {
    httpService = {
      post: jest.fn(),
    };
    configService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    };
    contextBuilder = {
      buildContext: jest.fn(),
    };

    adapter = new ClaudeAdapter(
      httpService as unknown as HttpService,
      configService as unknown as ConfigService,
      contextBuilder as any,
    );
  });

  it('当缺少 OPENROUTER_API_KEY 时应抛错并标记 ERROR', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      throw new Error(`Missing required key: ${key}`);
    });

    await expect(adapter.generate('hello', { sessionId: 's1' })).rejects.toThrow('OPENROUTER_API_KEY');
    expect(adapter.getStatus()).toBe(AgentStatus.OFFLINE);
  });

  it('generate 成功时应返回标准响应', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        OPENROUTER_API_KEY: 'fake-key',
        OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
        CLAUDE_TEMPERATURE: '0.7',
        CLAUDE_MAX_TOKENS: '4000',
        CLAUDE_TIMEOUT_MS: '60000',
      };
      return values[key];
    });
    configService.get.mockImplementation((key: string) => {
      if (key === 'OPENROUTER_HTTP_REFERER') {
        return 'https://lobster.local';
      }
      if (key === 'OPENROUTER_APP_TITLE') {
        return 'Lobster Coding Assistant';
      }
      return undefined;
    });
    httpService.post.mockReturnValue(
      of({
        data: {
          choices: [{ message: { content: 'test response' } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        },
      }),
    );

    const result = await adapter.generate('hello', { sessionId: 's1' });

    expect(result.content).toBe('test response');
    expect(result.tokenUsage).toEqual({ prompt: 10, completion: 20, total: 30 });
    expect(adapter.getStatus()).toBe(AgentStatus.ONLINE);
  });

  it('healthCheck 失败时应返回 false', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        OPENROUTER_API_KEY: 'fake-key',
        OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
        CLAUDE_TEMPERATURE: '0.7',
        CLAUDE_MAX_TOKENS: '4000',
        CLAUDE_TIMEOUT_MS: '60000',
      };
      return values[key];
    });
    httpService.post.mockReturnValue(throwError(() => new Error('network error')));

    await expect(adapter.healthCheck()).resolves.toBe(false);
  });

  it('streamGenerate 应按顺序产出 SSE delta', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        OPENROUTER_API_KEY: 'fake-key',
        OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
        CLAUDE_TEMPERATURE: '0.7',
        CLAUDE_MAX_TOKENS: '4000',
        CLAUDE_TIMEOUT_MS: '60000',
      };
      return values[key];
    });
    configService.get.mockImplementation((key: string) => {
      if (key === 'OPENROUTER_HTTP_REFERER') {
        return 'https://lobster.local';
      }
      if (key === 'OPENROUTER_APP_TITLE') {
        return 'Lobster Coding Assistant';
      }
      return undefined;
    });

    const sseIterable = {
      async *[Symbol.asyncIterator]() {
        yield 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n';
        yield 'data: {"choices":[{"delta":{"content":"lo"}}]}\n';
        yield 'data: [DONE]\n';
      },
    };
    httpService.post.mockReturnValue(of({ data: sseIterable }));

    const deltas: string[] = [];
    for await (const chunk of adapter.streamGenerate('hello', { sessionId: 's1' })) {
      deltas.push(chunk);
    }

    expect(deltas).toEqual(['Hel', 'lo']);
  });

  it('generate 应注入语义检索上下文到用户提示词', async () => {
    configService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        OPENROUTER_API_KEY: 'fake-key',
        OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
        CLAUDE_TEMPERATURE: '0.7',
        CLAUDE_MAX_TOKENS: '4000',
        CLAUDE_TIMEOUT_MS: '60000',
      };
      return values[key];
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
    httpService.post.mockReturnValue(
      of({
        data: {
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      }),
    );

    await adapter.generate('当前问题', { sessionId: 's1' });
    const payload = httpService.post.mock.calls[0][1] as any;
    expect(payload.messages[1].content).toContain('语义相关的历史上下文');
    expect(payload.messages[1].content).toContain('历史相关内容');
  });
});
