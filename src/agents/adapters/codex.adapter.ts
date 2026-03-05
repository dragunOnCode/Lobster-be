import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CliNotFoundError, CliRunnerService } from '../services/cli-runner.service';
import { AgentContext, AgentResponse, AgentStatus, DecisionResult, ILLMAdapter, Message } from '../interfaces';
import { PromptContextBuilderService } from '../services/prompt-context-builder.service';

@Injectable()
export class CodexAdapter implements ILLMAdapter {
  readonly id = 'codex-001';
  readonly name = 'Codex';
  readonly model = 'codex-cli';
  readonly type = 'codex';
  readonly role = '代码审查与质量把控';
  readonly capabilities = ['代码审查', '静态分析', '测试建议', '安全检查', '性能分析'];
  readonly callType = 'cli';

  private status: AgentStatus = AgentStatus.OFFLINE;
  private readonly keywords = ['审查', '检查', '测试', 'bug', '问题', '安全'];
  private readonly logger = new Logger(CodexAdapter.name);

  constructor(
    private readonly cliRunner: CliRunnerService,
    private readonly configService: ConfigService,
    private readonly promptContextBuilder?: PromptContextBuilderService,
  ) {}

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    const cliPath = this.configService.getOrThrow<string>('CODEX_CLI_PATH');
    const timeoutMs = Number(this.configService.getOrThrow<string>('CODEX_TIMEOUT_MS'));
    const historyLimit = Number(this.configService.get<string>('CODEX_CONTEXT_HISTORY_LIMIT') ?? '12');
    const semanticLimit = Number(this.configService.get<string>('CODEX_CONTEXT_SEMANTIC_LIMIT') ?? '3');
    const summaryLimit = Number(this.configService.get<string>('CODEX_CONTEXT_SUMMARY_LIMIT') ?? '2');
    const tokenBudget = Number(this.configService.get<string>('CODEX_CONTEXT_TOKEN_BUDGET') ?? '12000');
    const lineMaxChars = Number(this.configService.get<string>('CODEX_CONTEXT_LINE_MAX_CHARS') ?? '320');
    this.status = AgentStatus.BUSY;

    try {
      const enhancedContext = context;
      const userPrompt = this.promptContextBuilder?.buildUserPrompt(prompt) ?? this.buildUserPrompt(prompt);
      const promptBuilt = this.promptContextBuilder?.buildCliPromptWithMetrics(userPrompt, enhancedContext, {
        historyLimit,
        semanticLimit,
        summaryLimit,
        tokenBudget,
        lineMaxChars,
      });
      const cliPrompt =
        promptBuilt?.prompt ??
        this.buildCliPrompt(userPrompt, this.buildContextReferenceBlock(enhancedContext, userPrompt));
      this.logger.debug(`codex cliprompt = ${cliPrompt}`);
      this.logger.log(
        `generate session=${enhancedContext.sessionId} contextChars=${promptBuilt?.metrics.contextChars ?? cliPrompt.length} contextEstimatedTokens=${promptBuilt?.metrics.contextEstimatedTokens ?? Math.ceil(cliPrompt.length / 4)} historyItems=${promptBuilt?.metrics.historyItems ?? 'n/a'} semanticItems=${promptBuilt?.metrics.semanticItems ?? 'n/a'} summaryItems=${promptBuilt?.metrics.summaryItems ?? 'n/a'} trimmedItems=${promptBuilt?.metrics.trimmedItems ?? 'n/a'}`,
      );
      const result = await this.runCodex(cliPath, cliPrompt, timeoutMs);

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
    throw new Error('Codex CLI does not support streaming in Sprint 2');
  }

  async shouldRespond(message: Message, context: AgentContext): Promise<DecisionResult> {
    const text = message.content.toLowerCase();
    if (/@codex\b/i.test(message.content)) {
      return { should: true, reason: 'direct mention @Codex', priority: 'high' };
    }
    if (this.keywords.some((keyword) => text.includes(keyword))) {
      return { should: true, reason: 'review keywords matched', priority: 'medium' };
    }
    if (context.workspaceChange) {
      return { should: true, reason: 'workspace changed', priority: 'medium' };
    }
    return { should: false, reason: 'no matching rule' };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const cliPath = this.configService.getOrThrow<string>('CODEX_CLI_PATH');
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

  private parseCliOutput(stdout: string): { content: string; metadata?: Record<string, unknown> } {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { content: '' };
    }

    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const jsonLines = lines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((item): item is Record<string, unknown> => item !== null);

    if (jsonLines.length > 0) {
      if (jsonLines.length === 1 && !this.pickString(jsonLines[0], 'type')) {
        const single = jsonLines[0];
        const content =
          this.pickString(single, 'content') ?? this.pickString(single, 'message') ?? JSON.stringify(single);
        return {
          content,
          metadata: single,
        };
      }
      const content = this.extractContentFromEvents(jsonLines) ?? trimmed;
      return {
        content,
        metadata: { events: jsonLines },
      };
    }

    try {
      const json = JSON.parse(trimmed) as { content?: string; message?: string; [key: string]: unknown };
      const content =
        typeof json.content === 'string' ? json.content : typeof json.message === 'string' ? json.message : trimmed;
      return {
        content,
        metadata: json,
      };
    } catch {
      return { content: trimmed };
    }
  }

  private async runCodex(
    cliPath: string,
    prompt: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.logger.log(`runCodex: ${cliPath}, args: ${['exec', '--json', '-']}, timeout: ${timeoutMs}, input: ${prompt}`);
    return this.cliRunner.run({
      command: cliPath,
      args: ['exec', '--json', '-'],
      timeout: timeoutMs,
      input: prompt,
    });
  }

  private buildUserPrompt(prompt: string): string {
    const trimmed = prompt.trim();
    const withoutMention = trimmed.replace(/^@\S+\s*/u, '').trim();
    return withoutMention.length > 0 ? withoutMention : trimmed;
  }

  private buildCliPrompt(userPrompt: string, contextReference: string): string {
    return [
      `CURRENT_QUESTION: ${userPrompt}`,
      '',
      'CONTEXT_REFERENCE:',
      contextReference,
      '',
      '回答要求：优先直接回答 CURRENT_QUESTION；CONTEXT_REFERENCE 仅作补充参考。',
    ]
      .filter((part) => part.length > 0)
      .join('\n');
  }

  private buildContextReferenceBlock(context: AgentContext, currentUserPrompt: string): string {
    const sections: string[] = [];
    const normalizedCurrent = this.normalizeForDedup(currentUserPrompt);

    const historyLines = (context.conversationHistory ?? [])
      .filter((item) => item.content?.trim())
      .filter((item) => this.normalizeForDedup(item.content) !== normalizedCurrent)
      .slice(-6)
      .map((item) => {
        const role = item.role === 'assistant' && item.agentId ? `ASSISTANT(${item.agentId})` : item.role.toUpperCase();
        return `${role}: ${this.truncate(item.content.replace(/\s+/g, ' ').trim(), 220)}`;
      });
    if (historyLines.length > 0) {
      sections.push('近期对话:\n' + historyLines.join('\n'));
    }

    const semanticLines = (context.semanticContext ?? [])
      .slice(0, 3)
      .map((item, index) => `[${index + 1}] 相似度=${item.similarity.toFixed(3)} ${this.truncate(item.content, 220)}`);
    if (semanticLines.length > 0) {
      sections.push('语义相关历史:\n' + semanticLines.join('\n'));
    }

    const summaries = (context.summaries ?? [])
      .slice(0, 2)
      .map((item, index) => `${index + 1}. ${this.truncate(item, 220)}`);
    if (summaries.length > 0) {
      sections.push('历史摘要:\n' + summaries.join('\n'));
    }

    return sections.join('\n\n');
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) {
      return text;
    }
    return `${text.slice(0, maxLen)}...`;
  }

  private normalizeForDedup(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private extractContentFromEvents(events: Record<string, unknown>[]): string | undefined {
    const textCandidates = events
      .flatMap((event) => [this.pickString(event, 'final_response'), this.pickString(event, 'output_text')])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (textCandidates.length > 0) {
      return textCandidates[textCandidates.length - 1].trim();
    }

    const messageCandidates = events
      .map((event) => this.pickAssistantMessage(event))
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (messageCandidates.length > 0) {
      return messageCandidates[messageCandidates.length - 1].trim();
    }

    const itemCandidates = events
      .map((event) => this.pickAssistantItemText(event))
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (itemCandidates.length > 0) {
      return itemCandidates[itemCandidates.length - 1].trim();
    }

    return undefined;
  }

  private pickAssistantMessage(event: Record<string, unknown>): string | undefined {
    const message = event.message;
    if (!message || typeof message !== 'object') {
      return undefined;
    }

    const role = this.pickString(message as Record<string, unknown>, 'role');
    if (role !== 'assistant') {
      return undefined;
    }

    return (
      this.pickString(message as Record<string, unknown>, 'content') ??
      this.pickString(message as Record<string, unknown>, 'text')
    );
  }

  private pickString(obj: Record<string, unknown>, key: string): string | undefined {
    const value = obj[key];
    return typeof value === 'string' ? value : undefined;
  }

  private pickAssistantItemText(event: Record<string, unknown>): string | undefined {
    if (this.pickString(event, 'type') !== 'item.completed') {
      return undefined;
    }
    const item = event.item;
    if (!item || typeof item !== 'object') {
      return undefined;
    }
    const itemObj = item as Record<string, unknown>;
    if (this.pickString(itemObj, 'type') !== 'agent_message') {
      return undefined;
    }
    return this.pickString(itemObj, 'text');
  }
}
