import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AgentContext, AgentResponse, AgentStatus, DecisionResult, ILLMAdapter, Message } from '../interfaces';

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenRouterStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
}

@Injectable()
export class ClaudeAdapter implements ILLMAdapter {
  readonly id = 'claude-001';
  readonly name = 'Claude';
  readonly model = 'anthropic/claude-3-sonnet';
  readonly type = 'claude';
  readonly role = '架构设计与编码实现';
  readonly capabilities = ['架构设计', '代码生成', '技术选型', '重构'];
  readonly callType = 'http';

  private status: AgentStatus = AgentStatus.OFFLINE;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    const apiKey = this.configService.getOrThrow<string>('OPENROUTER_API_KEY');
    const baseUrl = this.configService.getOrThrow<string>('OPENROUTER_BASE_URL');
    const apiUrl = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const temperature = Number(this.configService.getOrThrow<string>('CLAUDE_TEMPERATURE'));
    const maxTokens = Number(this.configService.getOrThrow<string>('CLAUDE_MAX_TOKENS'));
    const timeoutMs = Number(this.configService.getOrThrow<string>('CLAUDE_TIMEOUT_MS'));
    const referer = this.configService.get<string>('OPENROUTER_HTTP_REFERER') ?? 'https://lobster.local';
    const title = this.configService.get<string>('OPENROUTER_APP_TITLE') ?? 'Lobster Coding Assistant';

    this.status = AgentStatus.BUSY;

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<OpenRouterResponse>(
          apiUrl,
          {
            model: this.model,
            messages: [
              {
                role: 'system',
                content: this.buildSystemPrompt(context),
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature,
            max_tokens: maxTokens,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': referer,
              'X-Title': title,
            },
            timeout: timeoutMs,
          },
        ),
      );

      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('Claude response is empty');
      }

      this.status = AgentStatus.ONLINE;

      return {
        content,
        tokenUsage: {
          prompt: data?.usage?.prompt_tokens ?? 0,
          completion: data?.usage?.completion_tokens ?? 0,
          total: data?.usage?.total_tokens ?? 0,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      this.status = AgentStatus.ERROR;
      throw error;
    }
  }

  async *streamGenerate(_prompt: string, _context: AgentContext): AsyncGenerator<string> {
    const apiKey = this.configService.getOrThrow<string>('OPENROUTER_API_KEY');
    const baseUrl = this.configService.getOrThrow<string>('OPENROUTER_BASE_URL');
    const apiUrl = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const temperature = Number(this.configService.getOrThrow<string>('CLAUDE_TEMPERATURE'));
    const maxTokens = Number(this.configService.getOrThrow<string>('CLAUDE_MAX_TOKENS'));
    const timeoutMs = Number(this.configService.getOrThrow<string>('CLAUDE_TIMEOUT_MS'));
    const referer = this.configService.get<string>('OPENROUTER_HTTP_REFERER') ?? 'https://lobster.local';
    const title = this.configService.get<string>('OPENROUTER_APP_TITLE') ?? 'Lobster Coding Assistant';

    this.status = AgentStatus.BUSY;
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          apiUrl,
          {
            model: this.model,
            messages: [
              {
                role: 'system',
                content: this.buildSystemPrompt(_context),
              },
              {
                role: 'user',
                content: _prompt,
              },
            ],
            temperature,
            max_tokens: maxTokens,
            stream: true,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': referer,
              'X-Title': title,
            },
            timeout: timeoutMs,
            responseType: 'stream',
          },
        ),
      );

      let buffer = '';
      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) {
            continue;
          }
          if (trimmed === 'data: [DONE]') {
            continue;
          }

          const payload = trimmed.slice(6);
          try {
            const json = JSON.parse(payload) as OpenRouterStreamChunk;
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              yield delta;
            }
          } catch {
            // 忽略无法解析的流式分片，继续处理后续chunk
          }
        }
      }

      this.status = AgentStatus.ONLINE;
    } catch (error) {
      this.status = AgentStatus.ERROR;
      throw error;
    }
  }

  async shouldRespond(_message: Message, _context: AgentContext): Promise<DecisionResult> {
    return {
      should: true,
      reason: 'MVP版本默认响应所有消息',
      priority: 'high',
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.generate('health check', { sessionId: 'health-check' });
      return !!result.content;
    } catch {
      return false;
    }
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private buildSystemPrompt(context: AgentContext): string {
    return [
      '你是Claude，一个专业的软件架构师和全栈开发工程师。',
      '你的职责是：',
      '1. 设计系统架构',
      '2. 编写高质量代码',
      '3. 提供技术选型建议',
      '4. 进行代码重构',
      '',
      `当前会话ID: ${context.sessionId}`,
      '请用专业、严谨、可执行的方式回答问题。',
    ].join('\n');
  }
}
