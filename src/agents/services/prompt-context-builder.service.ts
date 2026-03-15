import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentContext, Message, SemanticContextItem } from '../interfaces';

export interface PromptContextBuildOptions {
  historyLimit?: number;
  semanticLimit?: number;
  summaryLimit?: number;
  tokenBudget?: number;
  lineMaxChars?: number;
}

export interface PromptContextMetrics {
  contextChars: number;
  contextEstimatedTokens: number;
  historyItems: number;
  semanticItems: number;
  summaryItems: number;
  trimmedItems: number;
}

export interface PromptContextBuildResult {
  prompt: string;
  metrics: PromptContextMetrics;
}

@Injectable()
export class PromptContextBuilderService {
  private readonly defaultHistoryLimit: number;
  private readonly defaultSemanticLimit: number;
  private readonly defaultSummaryLimit: number;
  private readonly defaultTokenBudget: number;
  private readonly defaultLineMaxChars: number;

  constructor(private readonly configService: ConfigService) {
    this.defaultHistoryLimit = Number(this.configService.get<string>('AGENT_CONTEXT_HISTORY_LIMIT') ?? '12');
    this.defaultSemanticLimit = Number(this.configService.get<string>('AGENT_CONTEXT_SEMANTIC_LIMIT') ?? '3');
    this.defaultSummaryLimit = Number(this.configService.get<string>('AGENT_CONTEXT_SUMMARY_LIMIT') ?? '2');
    this.defaultTokenBudget = Number(this.configService.get<string>('AGENT_CONTEXT_TOKEN_BUDGET') ?? '12000');
    this.defaultLineMaxChars = Number(this.configService.get<string>('AGENT_CONTEXT_LINE_MAX_CHARS') ?? '1200');
  }

  buildUserPrompt(prompt: string): string {
    const trimmed = prompt.trim();
    const withoutMention = trimmed.replace(/^@\S+\s*/u, '').trim();
    return withoutMention.length > 0 ? withoutMention : trimmed;
  }

  buildCliPrompt(prompt: string, context: AgentContext, options?: PromptContextBuildOptions): string {
    return this.buildCliPromptWithMetrics(prompt, context, options).prompt;
  }

  buildCliPromptWithMetrics(
    userPrompt: string,
    context: AgentContext,
    options?: PromptContextBuildOptions,
  ): PromptContextBuildResult {
    const resolved = this.resolveOptions(options);
    const conversationBuilt = this.buildConversationReferenceBlock(
      context.conversationHistory ?? [],
      userPrompt,
      resolved,
    );
    const semanticBuilt = this.buildSemanticReferenceBlock(context.semanticContext ?? [], resolved);
    const summaryBuilt = this.buildSummaryReferenceBlock(context.summaries ?? [], resolved);

    const contextParts: string[] = [];
    if (conversationBuilt.content) {
      contextParts.push(conversationBuilt.content);
    }
    if (summaryBuilt.content) {
      contextParts.push(`Historical summaries:\n${summaryBuilt.content}`);
    }
    if (semanticBuilt.content) {
      contextParts.push(semanticBuilt.content);
    }

    const contextText = contextParts.join('\n\n').trim() || '(no context)';
    const prompt = [
      '# system',
      '',
      '你是一个专业的 AI 助手。你的任务是：',
      '',
      '1. 根据下面的context标题下的文本理解历史对话的上下文.',
      '2. 根据下面的user_intent标题下的文本理解用户当前的真实意图.',
      '3. 完成下面task标题下的任务，给出简洁、准确、上下文一致的回答.',
      '',
      '# context',
      '',
      '## conversation',
      '',
      contextText,
      '',
      '## user_intent',
      '',
      userPrompt.trim(),
      '',
      '# task',
      '',
      '请根据以上内容生成回答.',
    ].join('\n');

    const metrics: PromptContextMetrics = {
      contextChars: prompt.length,
      contextEstimatedTokens: this.estimateTokens(prompt),
      historyItems: conversationBuilt.selected,
      semanticItems: semanticBuilt.selected,
      summaryItems: summaryBuilt.selected,
      trimmedItems: conversationBuilt.trimmed + semanticBuilt.trimmed + summaryBuilt.trimmed,
    };

    return { prompt, metrics };
  }

  private buildConversationReferenceBlock(
    history: Message[],
    currentUserPrompt: string,
    options: Required<PromptContextBuildOptions>,
  ): { content: string; selected: number; trimmed: number } {
    if (!Array.isArray(history) || history.length === 0) {
      return { content: '', selected: 0, trimmed: 0 };
    }

    const normalizedCurrent = this.normalizeForDedup(currentUserPrompt);
    const maxChars = Math.max(1200, Math.floor(options.tokenBudget * 2.5));
    const selected: string[] = [];
    let usedChars = 0;
    let candidateCount = 0;

    for (let index = history.length - 1; index >= 0; index -= 1) {
      const item = history[index];
      if (!item?.content?.trim()) {
        continue;
      }

      const normalized = this.normalizeForDedup(item.content);
      if (this.shouldSkipHistoryItem(item, normalized, normalizedCurrent)) {
        continue;
      }

      candidateCount += 1;
      const role = item.role === 'user' ? 'User' : item.role === 'assistant' ? 'Assistant' : 'System';
      const normalizedContent = item.content.replace(/\s+/g, ' ').trim();
      const line = `${role}: ${this.truncate(normalizedContent, options.lineMaxChars)}`;

      if (usedChars + line.length > maxChars) {
        break;
      }
      selected.push(line);
      usedChars += line.length;

      if (selected.length >= options.historyLimit) {
        break;
      }
    }

    return {
      content: selected.reverse().join('\n'),
      selected: selected.length,
      trimmed: Math.max(0, candidateCount - selected.length),
    };
  }

  private shouldSkipHistoryItem(item: Message, normalized: string, normalizedCurrent: string): boolean {
    if (!normalized) {
      return true;
    }
    if (normalized !== normalizedCurrent) {
      return false;
    }
    // Keep assistant handoff line even if equal to current user intent.
    return item.role !== 'assistant';
  }

  private buildSemanticReferenceBlock(
    items: SemanticContextItem[],
    options: Required<PromptContextBuildOptions>,
  ): { content: string; selected: number; trimmed: number } {
    if (!Array.isArray(items) || items.length === 0) {
      return { content: '', selected: 0, trimmed: 0 };
    }

    const deduped = this.dedupeSemanticItems(items);
    const selected = deduped.slice(0, options.semanticLimit);
    if (selected.length === 0) {
      return { content: '', selected: 0, trimmed: 0 };
    }

    const semanticBlock = selected
      .map((item, index) => {
        const timestamp = item.timestamp ? ` time=${item.timestamp}` : '';
        return `[${index + 1}] similarity=${item.similarity.toFixed(3)}${timestamp}\n${this.truncate(item.content, options.lineMaxChars)}`;
      })
      .join('\n\n');

    return {
      content: ['Semantic context related to the current question (reference only):', semanticBlock].join('\n'),
      selected: selected.length,
      trimmed: Math.max(0, deduped.length - selected.length),
    };
  }

  private buildSummaryReferenceBlock(
    summaries: string[],
    options: Required<PromptContextBuildOptions>,
  ): { content: string; selected: number; trimmed: number } {
    if (!Array.isArray(summaries) || summaries.length === 0) {
      return { content: '', selected: 0, trimmed: 0 };
    }

    const selected = summaries.slice(0, options.summaryLimit);
    return {
      content: selected
        .map(
          (summary, index) =>
            `${index + 1}. ${this.truncate(summary.replace(/\s+/g, ' ').trim(), options.lineMaxChars)}`,
        )
        .join('\n'),
      selected: selected.length,
      trimmed: Math.max(0, summaries.length - selected.length),
    };
  }

  private dedupeSemanticItems(items: SemanticContextItem[]): SemanticContextItem[] {
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

  private resolveOptions(options?: PromptContextBuildOptions): Required<PromptContextBuildOptions> {
    return {
      historyLimit: this.safePositiveInt(options?.historyLimit, this.defaultHistoryLimit),
      semanticLimit: this.safePositiveInt(options?.semanticLimit, this.defaultSemanticLimit),
      summaryLimit: this.safePositiveInt(options?.summaryLimit, this.defaultSummaryLimit),
      tokenBudget: this.safePositiveInt(options?.tokenBudget, this.defaultTokenBudget),
      lineMaxChars: this.safePositiveInt(options?.lineMaxChars, this.defaultLineMaxChars),
    };
  }

  private safePositiveInt(value: number | undefined, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    return fallback;
  }

  private normalizeForDedup(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) {
      return text;
    }
    return `${text.slice(0, maxLen)}...`;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
