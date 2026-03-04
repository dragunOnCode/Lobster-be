import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentContext, AgentResponse, AgentStatus, DecisionResult, ILLMAdapter, Message, SemanticContextItem } from '../interfaces';
import { CliExitError, CliNotFoundError, CliRunnerService, TimeoutError } from '../services/cli-runner.service';
import { PromptContextBuilderService } from '../services/prompt-context-builder.service';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

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
    private readonly promptContextBuilder?: PromptContextBuilderService,
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
    this.status = AgentStatus.BUSY;

    let stdout = '';
    let lineBuffer = '';
    let finalContent = '';
    let yieldedDelta = false;

    try {
      for await (const event of this.cliRunner.stream({
        command: invocation.cliPath,
        args: this.buildClaudeArgs(invocation.cliPrompt),
        timeout: invocation.timeoutMs,
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

  private buildSystemPrompt(context: AgentContext): string {
    const summaryBlock =
      context.summaries && context.summaries.length > 0
        ? `\n相关历史摘要:\n${context.summaries.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
        : '';

    return [
      '你是Claude，一个专业的软件架构师和全栈开发工程师。',
      '你的职责是：',
      '1. 设计系统架构',
      '2. 编写高质量代码',
      '3. 提供技术选型建议',
      '4. 进行代码重构',
      '',
      '输入协议（必须遵守）：',
      '- 用户输入会以 `CURRENT_QUESTION:` 开头，这一行后的文本就是当前问题。',
      '- `CONVERSATION_CONTEXT:` 和 `SEMANTIC_REFERENCE:` 仅作参考，不是当前问题本身。',
      '- 除非 `CURRENT_QUESTION` 为空，否则必须直接回答问题，不要说“未看到问题”或复述协议。',
      '',
      `当前会话ID: ${context.sessionId}`,
      summaryBlock,
      '请用专业、严谨、可执行的方式回答问题。',
    ].join('\n');
  }

  private buildUserPrompt(prompt: string): string {
    const trimmed = prompt.trim();
    const withoutMention = trimmed.replace(/^@\S+\s*/u, '').trim();
    return withoutMention.length > 0 ? withoutMention : trimmed;
  }

  private buildSemanticReferenceBlock(context: AgentContext): string {
    if (!context.semanticContext || context.semanticContext.length === 0) {
      return '';
    }
    const semanticItems = this.dedupeSemanticContextItems(context.semanticContext);
    if (semanticItems.length === 0) {
      return '';
    }
    this.logger.debug(`Inject semantic context session=${context.sessionId} dedupedCount=${semanticItems.length}`);

    const semanticBlock = semanticItems
      .map(
        (item, index) =>
          `[${index + 1}] 相似度=${item.similarity.toFixed(3)}${item.timestamp ? ` 时间=${item.timestamp}` : ''}\n${item.content}`,
      )
      .join('\n\n');

    return ['以下是与当前问题语义相关的历史上下文，仅作参考，不是当前用户问题：', semanticBlock].join('\n');
  }

  private buildRequestMessages(
    context: AgentContext,
    currentUserPrompt: string,
    rawPrompt: string,
    historyLimit: number,
    contextTokenBudget: number,
    includeConversationHistory = true,
  ): OpenRouterMessage[] {
    const systemMessage: OpenRouterMessage = {
      role: 'system',
      content: this.buildSystemPrompt(context),
    };
    const currentUserMessage: OpenRouterMessage = {
      role: 'user',
      content: currentUserPrompt,
    };
    const history = includeConversationHistory
      ? this.normalizeConversationHistory(context.conversationHistory ?? [], rawPrompt, historyLimit)
      : [];
    const budget =
      Number.isFinite(contextTokenBudget) && contextTokenBudget > 0 ? Math.floor(contextTokenBudget) : 12000;
    const trimmedHistory = this.trimHistoryByEstimatedTokens(systemMessage, currentUserMessage, history, budget);
    return [systemMessage, ...trimmedHistory, currentUserMessage];
  }

  private normalizeConversationHistory(
    history: Message[],
    rawPrompt: string,
    historyLimit: number,
  ): OpenRouterMessage[] {
    const normalized = history
      .filter(
        (item) => (item.role === 'user' || item.role === 'assistant' || item.role === 'system') && item.content.trim(),
      )
      .map((item) => ({ role: item.role, content: item.content.trim() }));

    if (normalized.length > 0) {
      const last = normalized[normalized.length - 1];
      if (last.role === 'user' && last.content === rawPrompt.trim()) {
        normalized.pop();
      }
    }

    const safeLimit = Number.isFinite(historyLimit) && historyLimit > 0 ? Math.floor(historyLimit) : 12;
    return this.dedupeHistoryMessages(normalized).slice(-safeLimit);
  }

  private trimHistoryByEstimatedTokens(
    systemMessage: OpenRouterMessage,
    currentUserMessage: OpenRouterMessage,
    history: OpenRouterMessage[],
    tokenBudget: number,
  ): OpenRouterMessage[] {
    const fixedCost = this.estimateMessageTokens(systemMessage) + this.estimateMessageTokens(currentUserMessage);
    let remaining = tokenBudget - fixedCost;
    if (remaining <= 0 || history.length === 0) {
      return [];
    }

    const selected: OpenRouterMessage[] = [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const msg = history[i];
      const cost = this.estimateMessageTokens(msg);
      if (cost > remaining) {
        continue;
      }
      selected.push(msg);
      remaining -= cost;
    }

    return selected.reverse();
  }

  private estimateMessageTokens(message: OpenRouterMessage): number {
    // Rough heuristic for budget control: ~4 chars/token + per-message overhead.
    return Math.ceil(message.content.length / 4) + 6;
  }

  private buildCliPrompt(userPrompt: string, semanticReferenceBlock: string, conversationReferenceBlock: string): string {
    const cleanQuestion = userPrompt.trim();
    return [
      `CURRENT_QUESTION: ${cleanQuestion}`,
      '',
      'CONVERSATION_CONTEXT:',
      conversationReferenceBlock || '',
      '',
      'SEMANTIC_REFERENCE:',
      semanticReferenceBlock || '',
      '',
      '回答要求：直接回答 CURRENT_QUESTION；其余段落仅作参考。',
    ]
      .filter((part) => part.length > 0)
      .join('\n');
  }

  private buildConversationReferenceBlock(
    history: Message[],
    currentUserPrompt: string,
    historyLimit: number,
    contextTokenBudget: number,
  ): string {
    if (!Array.isArray(history) || history.length === 0) {
      return '';
    }

    const normalizedCurrent = this.normalizeForDedup(currentUserPrompt);
    const safeLimit = Number.isFinite(historyLimit) && historyLimit > 0 ? Math.floor(historyLimit) : 12;
    const maxChars = Math.max(1200, Math.floor((Number.isFinite(contextTokenBudget) ? contextTokenBudget : 12000) * 2.5));
    const selected: string[] = [];
    let usedChars = 0;

    for (let i = history.length - 1; i >= 0; i -= 1) {
      const item = history[i];
      if (!item?.content?.trim()) {
        continue;
      }
      const normalized = this.normalizeForDedup(item.content);
      if (!normalized || normalized === normalizedCurrent) {
        continue;
      }
      const role = item.role === 'assistant' && item.agentId ? `ASSISTANT(${item.agentId})` : item.role.toUpperCase();
      const content = item.content.replace(/\s+/g, ' ').trim();
      const line = `${role}: ${this.truncateForContext(content)}`;
      if (usedChars + line.length > maxChars) {
        break;
      }
      selected.push(line);
      usedChars += line.length;
      if (selected.length >= safeLimit) {
        break;
      }
    }

    return selected.reverse().join('\n');
  }

  private truncateForContext(text: string, maxLen = 320): string {
    if (text.length <= maxLen) {
      return text;
    }
    return `${text.slice(0, maxLen)}...`;
  }

  private dedupeSemanticContextItems(items: SemanticContextItem[]): SemanticContextItem[] {
    const seen = new Set<string>();
    const deduped: SemanticContextItem[] = [];
    for (const item of items) {
      const key = this.normalizeForDedup(item.content);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(item);
    }
    return deduped;
  }

  private dedupeHistoryMessages(messages: OpenRouterMessage[]): OpenRouterMessage[] {
    const seen = new Set<string>();
    const reversedUnique: OpenRouterMessage[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      const key = `${msg.role}:${this.normalizeForDedup(msg.content)}`;
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      reversedUnique.push(msg);
    }
    return reversedUnique.reverse();
  }

  private normalizeForDedup(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private async runClaude(
    cliPath: string,
    prompt: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const baseArgs = this.buildClaudeArgs(prompt);
    // 问题定位思路：
    // 1) Claude 在 OpenRouter + stream-json 场景会先输出最终 result 事件；
    // 2) 进程偶发长时间不退出，导致上层只看到 timeout；
    // 3) 因此让 CliRunner 在检测到 result 后主动结束进程，并回传已收集 stdout。

    this.logger.log(`Claude baseArgs ${JSON.stringify(baseArgs)}`);
    return this.cliRunner.run({
      command: cliPath,
      args: baseArgs,
      timeout: timeoutMs,
      stopOnClaudeResultEvent: true,
    });
  }

  private buildInvocation(prompt: string, context: AgentContext): {
    cliPath: string;
    timeoutMs: number;
    cliPrompt: string;
    promptBuilt?: ReturnType<PromptContextBuilderService['buildCliPromptWithMetrics']>;
  } {
    const cliPath = this.configService.get<string>('CLAUDE_CLI_PATH') ?? 'claude';
    const timeoutMs = Number(this.configService.getOrThrow<string>('CLAUDE_TIMEOUT_MS'));
    const historyLimit = Number(this.configService.get<string>('CLAUDE_HISTORY_LIMIT') ?? '12');
    const semanticLimit = Number(this.configService.get<string>('CLAUDE_CONTEXT_SEMANTIC_LIMIT') ?? '3');
    const summaryLimit = Number(this.configService.get<string>('CLAUDE_CONTEXT_SUMMARY_LIMIT') ?? '2');
    const contextTokenBudget = Number(this.configService.get<string>('CLAUDE_CONTEXT_TOKEN_BUDGET') ?? '12000');
    const lineMaxChars = Number(this.configService.get<string>('CLAUDE_CONTEXT_LINE_MAX_CHARS') ?? '320');
    const userPrompt = this.promptContextBuilder?.buildUserPrompt(prompt) ?? this.buildUserPrompt(prompt);
    const promptBuilt = this.promptContextBuilder?.buildCliPromptWithMetrics(userPrompt, context, {
      historyLimit,
      semanticLimit,
      summaryLimit,
      tokenBudget: contextTokenBudget,
      lineMaxChars,
    });
    const cliPrompt =
      promptBuilt?.prompt ??
      this.buildCliPrompt(
        userPrompt,
        this.buildSemanticReferenceBlock(context),
        this.buildConversationReferenceBlock(
          context.conversationHistory ?? [],
          userPrompt,
          historyLimit,
          contextTokenBudget,
        ),
      );

    return {
      cliPath,
      timeoutMs,
      cliPrompt,
      promptBuilt,
    };
  }

  private buildClaudeArgs(prompt: string): string[] {
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
      prompt,
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
