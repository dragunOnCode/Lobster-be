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
    this.defaultLineMaxChars = Number(this.configService.get<string>('AGENT_CONTEXT_LINE_MAX_CHARS') ?? '320');
  }

  buildUserPrompt(prompt: string): string {
    const trimmed = prompt.trim();
    const withoutMention = trimmed.replace(/^@\S+\s*/u, '').trim();
    return withoutMention.length > 0 ? withoutMention : trimmed;
  }

  buildCliPrompt(userPrompt: string, context: AgentContext, options?: PromptContextBuildOptions): string {
    return this.buildCliPromptWithMetrics(userPrompt, context, options).prompt;
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

    const prompt = [
      `CURRENT_QUESTION: ${userPrompt.trim()}`,
      '',
      'CONVERSATION_CONTEXT:',
      conversationBuilt.content,
      '',
      'SEMANTIC_REFERENCE:',
      semanticBuilt.content,
      '',
      'SUMMARY_REFERENCE:',
      summaryBuilt.content,
      '',
      '回答要求：直接回答 CURRENT_QUESTION；其余段落仅作参考。',
    ]
      .filter((part) => part.length > 0)
      .join('\n');
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

    for (let i = history.length - 1; i >= 0; i -= 1) {
      const item = history[i];
      if (!item?.content?.trim()) {
        continue;
      }
      const normalized = this.normalizeForDedup(item.content);
      if (!normalized || normalized === normalizedCurrent) {
        continue;
      }
      candidateCount += 1;
      const role = item.role === 'assistant' && item.agentId ? `ASSISTANT(${item.agentId})` : item.role.toUpperCase();
      const line = `${role}: ${this.truncate(item.content.replace(/\s+/g, ' ').trim(), options.lineMaxChars)}`;
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
        const meta = item.timestamp ? ` 时间=${item.timestamp}` : '';
        return `[${index + 1}] 相似度=${item.similarity.toFixed(3)}${meta}\n${this.truncate(item.content, options.lineMaxChars)}`;
      })
      .join('\n\n');

    return {
      content: ['以下是与当前问题语义相关的历史上下文，仅作参考，不是当前用户问题：', semanticBlock].join('\n'),
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
        .map((item, index) => `${index + 1}. ${this.truncate(item.replace(/\s+/g, ' ').trim(), options.lineMaxChars)}`)
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
