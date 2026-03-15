import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CliNotFoundError, CliRunnerService } from '../services/cli-runner.service';
import { AgentContext, AgentResponse, AgentStatus, DecisionResult, ILLMAdapter, Message } from '../interfaces';
import { PromptContextBuilderService } from '../services/prompt-context-builder.service';

@Injectable()
export class GeminiAdapter implements ILLMAdapter {
  readonly id = 'gemini-001';
  readonly name = 'Gemini';
  readonly model = 'gemini-pro';
  readonly type = 'gemini';
  readonly role = '创意发散与视觉设计';
  readonly capabilities = ['创意思维', 'UI设计建议', 'UX优化', '视觉效果', '交互设计'];
  readonly callType = 'cli';

  private status: AgentStatus = AgentStatus.OFFLINE;
  private readonly keywords = ['设计', 'ui', 'ux', '界面', '视觉', '交互', '创意', '美化'];
  private readonly logger = new Logger(GeminiAdapter.name);

  constructor(
    private readonly cliRunner: CliRunnerService,
    private readonly configService: ConfigService,
    private readonly promptContextBuilder: PromptContextBuilderService,
  ) {}

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    const cliPath = this.configService.getOrThrow<string>('GEMINI_CLI_PATH');
    const timeoutMs = Number(this.configService.getOrThrow<string>('GEMINI_TIMEOUT_MS'));
    const historyLimit = Number(this.configService.get<string>('GEMINI_CONTEXT_HISTORY_LIMIT') ?? '12');
    const semanticLimit = Number(this.configService.get<string>('GEMINI_CONTEXT_SEMANTIC_LIMIT') ?? '3');
    const summaryLimit = Number(this.configService.get<string>('GEMINI_CONTEXT_SUMMARY_LIMIT') ?? '2');
    const tokenBudget = Number(this.configService.get<string>('GEMINI_CONTEXT_TOKEN_BUDGET') ?? '12000');
    const lineMaxChars = Number(this.configService.get<string>('GEMINI_CONTEXT_LINE_MAX_CHARS') ?? '320');
    this.status = AgentStatus.BUSY;

    try {
      const enhancedContext = context;
      const userPrompt = this.promptContextBuilder.buildUserPrompt(prompt);
      const promptBuilt = this.promptContextBuilder.buildCliPromptWithMetrics(userPrompt, enhancedContext, {
        historyLimit,
        semanticLimit,
        summaryLimit,
        tokenBudget,
        lineMaxChars,
      });
      const cliPrompt = promptBuilt.prompt;
      this.logger.log(
        `generate session=${enhancedContext.sessionId} contextChars=${promptBuilt.metrics.contextChars} contextEstimatedTokens=${promptBuilt.metrics.contextEstimatedTokens} historyItems=${promptBuilt.metrics.historyItems} semanticItems=${promptBuilt.metrics.semanticItems} summaryItems=${promptBuilt.metrics.summaryItems} trimmedItems=${promptBuilt.metrics.trimmedItems}`,
      );
      const result = await this.runGemini(cliPath, cliPrompt, timeoutMs);

      const parsed = this.parseCliOutput(result.stdout);

      this.status = AgentStatus.ONLINE;
      return {
        content: parsed.content,
        metadata: parsed.metadata,
        timestamp: new Date(),
      };
    } catch (error) {
      this.status = AgentStatus.ERROR;
      throw error;
    }
  }

  async *streamGenerate(_prompt: string, _context: AgentContext): AsyncGenerator<string> {
    throw new Error('Gemini CLI does not support streaming in Sprint 2');
  }

  async shouldRespond(message: Message, _context: AgentContext): Promise<DecisionResult> {
    const text = message.content.toLowerCase();
    if (/@gemini\b/i.test(message.content)) {
      return { should: true, reason: 'direct mention @Gemini', priority: 'high' };
    }
    if (this.keywords.some((keyword) => text.includes(keyword))) {
      return { should: true, reason: 'design keywords matched', priority: 'medium' };
    }
    return { should: false, reason: 'no matching rule' };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const cliPath = this.configService.getOrThrow<string>('GEMINI_CLI_PATH');
      await this.cliRunner.run({
        command: cliPath,
        args: ['--version'],
        timeout: 5000,
      });
      return true;
    } catch (error) {
      if (error instanceof CliNotFoundError) {
        return false;
      }
      return false;
    }
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private async runGemini(
    cliPath: string,
    prompt: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.cliRunner.run({
      command: cliPath,
      args: ['-p', prompt, '--output-format', 'json'],
      timeout: timeoutMs,
    });
  }

  private parseCliOutput(stdout: string): { content: string; metadata?: Record<string, unknown> } {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { content: '' };
    }

    try {
      const json = JSON.parse(trimmed) as {
        content?: string;
        message?: string;
        response?: string;
        [key: string]: unknown;
      };
      const content =
        typeof json.content === 'string'
          ? json.content
          : typeof json.message === 'string'
            ? json.message
            : typeof json.response === 'string'
              ? json.response
              : trimmed;
      return {
        content,
        metadata: json,
      };
    } catch {
      return { content: trimmed };
    }
  }
}
