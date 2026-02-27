import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentContext, AgentResponse, AgentStatus, DecisionResult, ILLMAdapter, Message } from '../interfaces';
import { ContextBuilderService } from '../services/context-builder.service';
import { CliExitError, CliNotFoundError, CliRunnerService, TimeoutError } from '../services/cli-runner.service';
import { SharedMemoryService } from '../../memory/services/shared-memory.service';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class ClaudeAdapter implements ILLMAdapter {
  readonly id = 'claude-001';
  readonly name = 'Claude';
  readonly model = 'anthropic/claude-sonnet-4.6';
  readonly type = 'claude';
  readonly role = '架构设计与编码实现';
  readonly capabilities = ['架构设计', '代码生成', '技术选型', '重构'];
  readonly callType = 'cli';

  private status: AgentStatus = AgentStatus.OFFLINE;
  private readonly claudeSessionsByWorkspaceSession = new Map<string, string>();
  private readonly logger = new Logger(ClaudeAdapter.name);

  constructor(
    private readonly cliRunner: CliRunnerService,
    private readonly configService: ConfigService,
    private readonly sharedMemoryService: SharedMemoryService,
    private readonly contextBuilder?: ContextBuilderService,
  ) {}

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    const cliPath = this.configService.get<string>('CLAUDE_CLI_PATH') ?? 'claude';
    const timeoutMs = Number(this.configService.getOrThrow<string>('CLAUDE_TIMEOUT_MS'));
    const historyLimit = Number(this.configService.get<string>('CLAUDE_HISTORY_LIMIT') ?? '12');
    const contextTokenBudget = Number(this.configService.get<string>('CLAUDE_CONTEXT_TOKEN_BUDGET') ?? '12000');

    this.status = AgentStatus.BUSY;

    try {
      const enhancedContext = await this.buildEnhancedContext(prompt, context);
      this.logger.debug(
        `Prompt context session=${enhancedContext.sessionId} semanticItems=${enhancedContext.semanticContext?.length ?? 0} summaries=${enhancedContext.summaries?.length ?? 0}`,
      );
      const userPrompt = this.buildUserPrompt(prompt, enhancedContext);
      const messages = this.buildRequestMessages(enhancedContext, userPrompt, prompt, historyLimit, contextTokenBudget);
      const cliPrompt = this.buildCliPrompt(messages);
      const existingSessionId = await this.resolveExistingSessionId(context.sessionId);
      const result = await this.runClaude(cliPath, cliPrompt, timeoutMs, existingSessionId);
      const parsed = this.parseCliOutput(result.stdout);
      const claudeSessionId = this.extractClaudeSessionId(parsed.metadata);
      if (claudeSessionId) {
        await this.persistSessionBinding(context.sessionId, claudeSessionId);
      }

      const content = parsed.content.trim();
      if (!content) {
        throw new Error('Claude response is empty');
      }

      this.status = AgentStatus.ONLINE;

      return {
        content,
        tokenUsage: parsed.tokenUsage,
        metadata: {
          ...parsed.metadata,
          claudeSessionId,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      this.status = AgentStatus.ERROR;
      throw this.normalizeCliError(error, cliPath);
    }
  }

  async *streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string> {
    const response = await this.generate(prompt, context);
    if (response.content) {
      yield response.content;
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
      `当前会话ID: ${context.sessionId}`,
      summaryBlock,
      '请用专业、严谨、可执行的方式回答问题。',
    ].join('\n');
  }

  private buildUserPrompt(prompt: string, context: AgentContext): string {
    if (!context.semanticContext || context.semanticContext.length === 0) {
      return prompt;
    }
    this.logger.debug(`Inject semantic context session=${context.sessionId} count=${context.semanticContext.length}`);

    const semanticBlock = context.semanticContext
      .map(
        (item, index) =>
          `[${index + 1}] 相似度=${item.similarity.toFixed(3)}${item.timestamp ? ` 时间=${item.timestamp}` : ''}\n${item.content}`,
      )
      .join('\n\n');

    return ['以下是与当前问题语义相关的历史上下文，请优先参考：', semanticBlock, '', '当前用户问题：', prompt].join(
      '\n',
    );
  }

  private buildRequestMessages(
    context: AgentContext,
    currentUserPrompt: string,
    rawPrompt: string,
    historyLimit: number,
    contextTokenBudget: number,
  ): OpenRouterMessage[] {
    const systemMessage: OpenRouterMessage = {
      role: 'system',
      content: this.buildSystemPrompt(context),
    };
    const currentUserMessage: OpenRouterMessage = {
      role: 'user',
      content: currentUserPrompt,
    };
    const history = this.normalizeConversationHistory(context.conversationHistory ?? [], rawPrompt, historyLimit);
    const budget = Number.isFinite(contextTokenBudget) && contextTokenBudget > 0 ? Math.floor(contextTokenBudget) : 12000;
    const trimmedHistory = this.trimHistoryByEstimatedTokens(systemMessage, currentUserMessage, history, budget);
    return [systemMessage, ...trimmedHistory, currentUserMessage];
  }

  private normalizeConversationHistory(
    history: Message[],
    rawPrompt: string,
    historyLimit: number,
  ): OpenRouterMessage[] {
    const normalized = history
      .filter((item) => (item.role === 'user' || item.role === 'assistant' || item.role === 'system') && item.content.trim())
      .map((item) => ({ role: item.role, content: item.content.trim() }));

    if (normalized.length > 0) {
      const last = normalized[normalized.length - 1];
      if (last.role === 'user' && last.content === rawPrompt.trim()) {
        normalized.pop();
      }
    }

    const safeLimit = Number.isFinite(historyLimit) && historyLimit > 0 ? Math.floor(historyLimit) : 12;
    return normalized.slice(-safeLimit);
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

  private buildCliPrompt(messages: OpenRouterMessage[]): string {
    const system = messages.find((item) => item.role === 'system')?.content ?? '';
    const conversation = messages
      .filter((item) => item.role !== 'system')
      .map((item) => `${item.role.toUpperCase()}:\n${item.content}`)
      .join('\n\n');

    return ['你将继续以下对话并仅输出最终答复。', '', '系统指令:', system, '', '对话上下文:', conversation]
      .filter((part) => part.length > 0)
      .join('\n');
  }

  private async runClaude(
    cliPath: string,
    prompt: string,
    timeoutMs: number,
    existingSessionId?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const baseArgs = ['-p', '--output-format', 'json', prompt];

    if (!existingSessionId) {
      return this.cliRunner.run({
        command: cliPath,
        args: baseArgs,
        timeout: timeoutMs,
      });
    }

    try {
      return await this.cliRunner.run({
        command: cliPath,
        args: ['-r', existingSessionId, ...baseArgs],
        timeout: timeoutMs,
      });
    } catch (error) {
      if (!this.shouldFallbackToFreshSession(error)) {
        throw error;
      }
      return this.cliRunner.run({
        command: cliPath,
        args: baseArgs,
        timeout: timeoutMs,
      });
    }
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

    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        content: this.extractTextFromJsonRecord(json) ?? trimmed,
        tokenUsage: this.extractTokenUsage(json),
        metadata: json,
      };
    } catch {
      const lines = trimmed
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const events = lines
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
        return {
          content: textFromEvents ?? trimmed,
          tokenUsage: this.extractTokenUsage(events[events.length - 1]),
          metadata: { events },
        };
      }

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
    }
    return undefined;
  }

  private extractClaudeSessionId(metadata?: Record<string, unknown>): string | undefined {
    if (!metadata) {
      return undefined;
    }

    const direct = this.pickString(metadata, ['session_id', 'sessionId', 'conversation_id', 'conversationId']);
    if (direct) {
      return direct;
    }

    const events = metadata.events;
    if (!Array.isArray(events)) {
      return undefined;
    }

    for (const event of events) {
      if (!event || typeof event !== 'object') {
        continue;
      }
      const eventObj = event as Record<string, unknown>;
      const sessionId = this.pickString(eventObj, ['session_id', 'sessionId', 'conversation_id', 'conversationId']);
      if (sessionId) {
        return sessionId;
      }
    }

    return undefined;
  }

  private extractTokenUsage(record: Record<string, unknown> | undefined): {
    prompt: number;
    completion: number;
    total: number;
  } | undefined {
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

  private shouldFallbackToFreshSession(error: unknown): boolean {
    if (!(error instanceof CliExitError)) {
      return false;
    }
    const stderr = error.stderr.toLowerCase();
    return (
      stderr.includes('not found') ||
      stderr.includes('no session') ||
      stderr.includes('invalid') ||
      stderr.includes('unknown') ||
      stderr.includes('expired')
    );
  }

  private async resolveExistingSessionId(workspaceSessionId: string): Promise<string | undefined> {
    const localSessionId = this.claudeSessionsByWorkspaceSession.get(workspaceSessionId);
    if (localSessionId) {
      return localSessionId;
    }

    try {
      const binding = await this.sharedMemoryService.getAgentThreadBinding(workspaceSessionId, this.id);
      if (!binding?.threadId) {
        return undefined;
      }
      this.claudeSessionsByWorkspaceSession.set(workspaceSessionId, binding.threadId);
      return binding.threadId;
    } catch {
      return undefined;
    }
  }

  private async persistSessionBinding(workspaceSessionId: string, claudeSessionId: string): Promise<void> {
    this.claudeSessionsByWorkspaceSession.set(workspaceSessionId, claudeSessionId);
    try {
      await this.sharedMemoryService.setAgentThreadBinding(workspaceSessionId, this.id, claudeSessionId);
    } catch {
      // Redis 不可用时降级到进程内映射
    }
  }

  private async buildEnhancedContext(prompt: string, context: AgentContext): Promise<AgentContext> {
    if (!this.contextBuilder) {
      return context;
    }

    try {
      const built = await this.contextBuilder.buildContext(context.sessionId, prompt, context.userId);
      return {
        ...context,
        ...built,
        workspaceChange: context.workspaceChange ?? built.workspaceChange,
      };
    } catch {
      this.logger.warn(`Context build failed session=${context.sessionId}, fallback to provided context`);
      return context;
    }
  }

  private normalizeCliError(error: unknown, cliPath: string): Error {
    if (error instanceof CliNotFoundError) {
      return new Error(`Claude CLI not found: ${cliPath}`);
    }
    if (error instanceof TimeoutError) {
      return new Error(`Claude CLI timeout after ${error.timeoutMs}ms`);
    }
    if (error instanceof CliExitError) {
      const stderr = error.stderr?.trim() || 'unknown error';
      this.logger.error(`Claude CLI failed exitCode=${error.exitCode} reason=${stderr}`);
      return new Error(`Claude CLI exited with code ${error.exitCode}: ${stderr}`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
