import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentContext, AgentResponse, AgentStatus, DecisionResult, ILLMAdapter, Message } from '../interfaces';
import { CliExitError, CliNotFoundError, CliRunnerService, TimeoutError } from '../services/cli-runner.service';
import { PromptContextBuilderService } from '../services/prompt-context-builder.service';

@Injectable()
export class ClaudeAdapter implements ILLMAdapter {
  readonly id = 'claude-001';
  readonly name = 'Claude';
  readonly model = 'glm-5';
  readonly type = 'claude';
  readonly role = '架构设计与编码实现';
  readonly capabilities = ['架构设计', '代码生成', '技术选型', '重构'];
  readonly callType = 'cli';

  private status: AgentStatus = AgentStatus.OFFLINE;
  private readonly logger = new Logger(ClaudeAdapter.name);

  constructor(
    private readonly cliRunner: CliRunnerService,
    private readonly configService: ConfigService,
    private readonly promptContextBuilder: PromptContextBuilderService,
  ) {}

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    const invocation = this.buildInvocation(prompt, context);

    this.status = AgentStatus.BUSY;

    try {
      this.logger.debug(
        `Prompt context session=${context.sessionId} semanticItems=${context.semanticContext?.length ?? 0} summaries=${context.summaries?.length ?? 0}`,
      );
      const invokeAt = Date.now();
      this.logger.log(
        `Invoke Claude CLI session=${context.sessionId} timeoutMs=${invocation.timeoutMs} promptChars=${invocation.cliPrompt.length} contextChars=${invocation.promptBuilt?.metrics.contextChars ?? invocation.cliPrompt.length} contextEstimatedTokens=${invocation.promptBuilt?.metrics.contextEstimatedTokens ?? Math.ceil(invocation.cliPrompt.length / 4)} historyItems=${invocation.promptBuilt?.metrics.historyItems ?? 'n/a'} semanticItems=${invocation.promptBuilt?.metrics.semanticItems ?? 'n/a'} summaryItems=${invocation.promptBuilt?.metrics.summaryItems ?? 'n/a'} trimmedItems=${invocation.promptBuilt?.metrics.trimmedItems ?? 'n/a'}`,
      );
      this.logger.debug(`claude cliprompt = ${invocation.cliPrompt}`);
      const result = await this.runClaude(invocation.cliPath, invocation.cliPrompt, invocation.timeoutMs);
      this.logger.log(
        `Claude CLI completed in ${Date.now() - invokeAt}ms exitCode=${result.exitCode} stdoutChars=${result.stdout.length} stderrChars=${result.stderr.length}`,
      );
      const parsed = this.parseCliOutput(result.stdout);

      const content = parsed.content.trim();
      if (!content) {
        throw new Error('Claude response is empty');
      }

      this.status = AgentStatus.ONLINE;

      return {
        content,
        tokenUsage: parsed.tokenUsage,
        metadata: parsed.metadata,
        timestamp: new Date(),
      };
    } catch (error) {
      if (error instanceof TimeoutError && error.stdout?.trim()) {
        const parsed = this.parseCliOutput(error.stdout);
        const content = parsed.content.trim();
        if (content) {
          this.logger.warn(
            `Claude CLI timed out but recovered content from partial stdout session=${context.sessionId} chars=${content.length}`,
          );
          this.status = AgentStatus.ONLINE;
          return {
            content,
            tokenUsage: parsed.tokenUsage,
            metadata: {
              ...parsed.metadata,
              recoveredFromTimeout: true,
            },
            timestamp: new Date(),
          };
        }
      }
      this.status = AgentStatus.ERROR;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Claude generate failed session=${context.sessionId} reason=${message}`);
      throw this.normalizeCliError(error, invocation.cliPath);
    }
  }

  async *streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string> {
    const invocation = this.buildInvocation(prompt, context);
    this.logger.debug(`[claude] streamGenerate prompt = ${invocation.cliPrompt}`);
    this.status = AgentStatus.BUSY;

    let stdout = '';
    let lineBuffer = '';
    let finalContent = '';
    let yieldedDelta = false;

    try {
      for await (const event of this.cliRunner.stream({
        command: invocation.cliPath,
        args: this.buildClaudeArgs(),
        timeout: invocation.timeoutMs,
        input: invocation.cliPrompt,
        stopOnClaudeResultEvent: true,
      })) {
        if (event.stream !== 'stdout') {
          continue;
        }

        stdout += event.chunk;
        lineBuffer += event.chunk;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const parsed = this.parseStreamLine(rawLine);
          if (parsed.finalContent) {
            finalContent = parsed.finalContent;
          }
          if (!parsed.delta) {
            continue;
          }
          yieldedDelta = true;
          yield parsed.delta;
        }
      }

      if (lineBuffer.trim()) {
        const parsed = this.parseStreamLine(lineBuffer);
        if (parsed.finalContent) {
          finalContent = parsed.finalContent;
        }
        if (parsed.delta) {
          yieldedDelta = true;
          yield parsed.delta;
        }
      }

      if (!yieldedDelta && finalContent.trim()) {
        yield finalContent.trim();
      }

      this.status = AgentStatus.ONLINE;
    } catch (error) {
      if (error instanceof TimeoutError && error.stdout?.trim()) {
        const parsed = this.parseCliOutput(error.stdout);
        if (parsed.content.trim().length > 0 && !yieldedDelta) {
          this.logger.warn(
            `Claude stream timed out but recovered content from partial stdout session=${context.sessionId} chars=${parsed.content.length}`,
          );
          this.status = AgentStatus.ONLINE;
          yield parsed.content;
          return;
        }
      }

      if (stdout.trim().length > 0 && !yieldedDelta) {
        const parsed = this.parseCliOutput(stdout);
        if (parsed.content.trim().length > 0) {
          this.logger.warn(
            `Claude stream fell back to buffered stdout session=${context.sessionId} chars=${parsed.content.length}`,
          );
          this.status = AgentStatus.ONLINE;
          yield parsed.content;
          return;
        }
      }

      this.status = AgentStatus.ERROR;
      throw this.normalizeCliError(error, invocation.cliPath);
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
      const cliPath = this.configService.get<string>('CLAUDE_CLI_PATH') ?? 'claude';
      await this.cliRunner.run({
        command: cliPath,
        args: ['--version'],
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private async runClaude(
    cliPath: string,
    prompt: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const baseArgs = this.buildClaudeArgs();
    // 问题定位思路：
    // 1) Claude 在 OpenRouter + stream-json 场景会先输出最终 result 事件；
    // 2) 进程偶发长时间不退出，导致上层只看到 timeout；
    // 3) 因此让 CliRunner 在检测到 result 后主动结束进程，并回传已收集 stdout。

    this.logger.log(`Claude baseArgs ${JSON.stringify(baseArgs)}`);
    return this.cliRunner.run({
      command: cliPath,
      args: baseArgs,
      timeout: timeoutMs,
      input: prompt,
      stopOnClaudeResultEvent: true,
    });
  }

  private buildInvocation(
    prompt: string,
    context: AgentContext,
  ): {
    cliPath: string;
    timeoutMs: number;
    cliPrompt: string;
    promptBuilt: ReturnType<PromptContextBuilderService['buildCliPromptWithMetrics']>;
  } {
    const cliPath = this.configService.get<string>('CLAUDE_CLI_PATH') ?? 'claude';
    const timeoutMs = Number(this.configService.getOrThrow<string>('CLAUDE_TIMEOUT_MS'));
    const historyLimit = Number(this.configService.get<string>('CLAUDE_HISTORY_LIMIT') ?? '12');
    const semanticLimit = Number(this.configService.get<string>('CLAUDE_CONTEXT_SEMANTIC_LIMIT') ?? '3');
    const summaryLimit = Number(this.configService.get<string>('CLAUDE_CONTEXT_SUMMARY_LIMIT') ?? '2');
    const contextTokenBudget = Number(this.configService.get<string>('CLAUDE_CONTEXT_TOKEN_BUDGET') ?? '12000');
    const lineMaxChars = Number(this.configService.get<string>('CLAUDE_CONTEXT_LINE_MAX_CHARS') ?? '320');
    const userPrompt = this.promptContextBuilder.buildUserPrompt(prompt);
    const promptBuilt = this.promptContextBuilder.buildCliPromptWithMetrics(userPrompt, context, {
      historyLimit,
      semanticLimit,
      summaryLimit,
      tokenBudget: contextTokenBudget,
      lineMaxChars,
    });
    const cliPrompt = promptBuilt.prompt;

    this.logger.debug(`[claude] cliprompt = ${cliPrompt}`);

    return {
      cliPath,
      timeoutMs,
      cliPrompt,
      promptBuilt,
    };
  }

  private buildClaudeArgs(): string[] {
    return [
      '--model',
      this.model,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
      '--tools',
      '',
      '-p',
    ];
  }

  private parseStreamLine(line: string): { delta?: string; finalContent?: string } {
    const trimmed = line.trim();
    if (!trimmed) {
      return {};
    }

    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      const type = this.pickString(record, ['type']);
      if (type === 'result') {
        return {
          finalContent: this.extractTextFromJsonRecord(record)?.trim(),
        };
      }

      const delta = this.extractStreamDelta(record);
      if (delta) {
        return { delta };
      }

      return {};
    } catch {
      return {};
    }
  }

  private extractStreamDelta(record: Record<string, unknown>): string | undefined {
    const delta = record.delta;
    if (typeof delta === 'string' && delta.trim().length > 0) {
      return delta;
    }
    if (delta && typeof delta === 'object') {
      const deltaObj = delta as Record<string, unknown>;
      if (typeof deltaObj.text === 'string' && deltaObj.text.trim().length > 0) {
        return deltaObj.text;
      }
    }

    const content = record.content;
    if (content && Array.isArray(content)) {
      const textBlocks = content
        .map((block) => this.extractTextFromContentBlock(block))
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (textBlocks.length > 0) {
        return textBlocks.join('\n');
      }
    }

    return this.pickString(record, ['partial_text', 'output_text', 'completion']);
  }

  private parseCliOutput(stdout: string): {
    content: string;
    tokenUsage?: { prompt: number; completion: number; total: number };
    metadata?: Record<string, unknown>;
  } {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { content: '' };
    }

    const events = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((item): item is Record<string, unknown> => item !== null);

    if (events.length > 0) {
      const textFromEvents = this.extractTextFromEvents(events);
      const lastEvent = events[events.length - 1];
      return {
        content: textFromEvents ?? trimmed,
        tokenUsage: this.extractTokenUsage(lastEvent),
        metadata: { ...lastEvent, events },
      };
    }

    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        content: this.extractTextFromJsonRecord(json) ?? trimmed,
        tokenUsage: this.extractTokenUsage(json),
        metadata: json,
      };
    } catch {
      return { content: trimmed };
    }
  }

  private extractTextFromEvents(events: Record<string, unknown>[]): string | undefined {
    const candidates = events
      .map((event) => this.extractTextFromJsonRecord(event))
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return candidates.length > 0 ? candidates[candidates.length - 1].trim() : undefined;
  }

  private extractTextFromJsonRecord(record: Record<string, unknown>): string | undefined {
    const direct = ['content', 'message', 'result', 'response', 'output_text', 'text']
      .map((key) => record[key])
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (direct) {
      return direct;
    }

    const message = record.message;
    if (message && typeof message === 'object') {
      const nested = message as Record<string, unknown>;
      const nestedText = nested.content ?? nested.text;
      if (typeof nestedText === 'string' && nestedText.trim()) {
        return nestedText;
      }
      if (Array.isArray(nestedText)) {
        const textBlocks = nestedText
          .map((block) => this.extractTextFromContentBlock(block))
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
        if (textBlocks.length > 0) {
          return textBlocks.join('\n');
        }
      }
    }

    const contentBlocks = record.content;
    if (Array.isArray(contentBlocks)) {
      const textBlocks = contentBlocks
        .map((block) => this.extractTextFromContentBlock(block))
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (textBlocks.length > 0) {
        return textBlocks.join('\n');
      }
    }

    const deltaText = this.pickString(record, ['delta', 'partial_text', 'output_text', 'completion']);
    if (deltaText) {
      return deltaText;
    }
    return undefined;
  }

  private extractTextFromContentBlock(block: unknown): string | undefined {
    if (!block || typeof block !== 'object') {
      return undefined;
    }
    const blockObj = block as Record<string, unknown>;
    if (blockObj.type === 'text' && typeof blockObj.text === 'string' && blockObj.text.trim().length > 0) {
      return blockObj.text;
    }
    if (typeof blockObj.text === 'string' && blockObj.text.trim().length > 0) {
      return blockObj.text;
    }
    const nestedDelta = blockObj.delta;
    if (nestedDelta && typeof nestedDelta === 'object') {
      const deltaObj = nestedDelta as Record<string, unknown>;
      if (typeof deltaObj.text === 'string' && deltaObj.text.trim().length > 0) {
        return deltaObj.text;
      }
    }
    return undefined;
  }

  private extractTokenUsage(record: Record<string, unknown> | undefined):
    | {
        prompt: number;
        completion: number;
        total: number;
      }
    | undefined {
    if (!record) {
      return undefined;
    }

    const usage = (record.usage ?? record.token_usage ?? record.tokens) as Record<string, unknown> | undefined;
    if (!usage || typeof usage !== 'object') {
      return undefined;
    }

    const prompt = this.pickNumber(usage, ['prompt_tokens', 'input_tokens', 'prompt']);
    const completion = this.pickNumber(usage, ['completion_tokens', 'output_tokens', 'completion']);
    const totalValue = this.pickNumber(usage, ['total_tokens', 'total']);
    const total = totalValue > 0 ? totalValue : prompt + completion;

    if (prompt === 0 && completion === 0 && total === 0) {
      return undefined;
    }
    return { prompt, completion, total };
  }

  private pickNumber(obj: Record<string, unknown>, keys: string[]): number {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return 0;
  }

  private pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return undefined;
  }

  private normalizeCliError(error: unknown, cliPath: string): Error {
    if (error instanceof CliNotFoundError) {
      return new Error(`Claude CLI not found: ${cliPath}`);
    }
    if (error instanceof TimeoutError) {
      return new Error(
        `Claude CLI timeout after ${error.timeoutMs}ms (tip: increase CLAUDE_TIMEOUT_MS, e.g. 180000-300000)`,
      );
    }
    if (error instanceof CliExitError) {
      const stderr = error.stderr?.trim() || 'unknown error';
      this.logger.error(`Claude CLI failed exitCode=${error.exitCode} reason=${stderr}`);
      return new Error(`Claude CLI exited with code ${error.exitCode}: ${stderr}`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
