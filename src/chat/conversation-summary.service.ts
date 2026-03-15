import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemoryMessage, ShortTermMemoryService } from '../memory/services/short-term-memory.service';
import { SharedMemoryService } from '../memory/services/shared-memory.service';
import { ChromaService } from '../vector/services/chroma.service';

interface SummaryState {
  autoSummary?: string;
  autoSummaryUpdatedAt?: string;
  autoSummaryMessageCount?: number;
  autoSummaryFingerprint?: string;
}

@Injectable()
export class ConversationSummaryService {
  private readonly logger = new Logger(ConversationSummaryService.name);
  private readonly enabled: boolean;
  private readonly triggerMessages: number;
  private readonly minIntervalMessages: number;
  private readonly lookbackMessages: number;

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly shortTermMemoryService?: ShortTermMemoryService,
    @Optional() private readonly sharedMemoryService?: SharedMemoryService,
    @Optional() private readonly chromaService?: ChromaService,
  ) {
    this.enabled = (this.configService.get<string>('CONVERSATION_SUMMARY_ENABLED') ?? 'true') !== 'false';
    this.triggerMessages = Number(this.configService.get<string>('CONVERSATION_SUMMARY_TRIGGER_MESSAGES') ?? '10');
    this.minIntervalMessages = Number(
      this.configService.get<string>('CONVERSATION_SUMMARY_MIN_INTERVAL_MESSAGES') ?? '5',
    );
    this.lookbackMessages = Number(this.configService.get<string>('CONVERSATION_SUMMARY_LOOKBACK_MESSAGES') ?? '12');
  }

  async maybeGenerate(sessionId: string): Promise<void> {
    if (!this.enabled || !this.shortTermMemoryService || !this.sharedMemoryService) {
      return;
    }

    const messages = await this.shortTermMemoryService.get(sessionId);
    if (messages.length < this.triggerMessages) {
      return;
    }

    const workspaceState = (await this.sharedMemoryService.getWorkspaceState(sessionId)) ?? {
      sessionId,
      updatedAt: new Date().toISOString(),
    };
    const state = workspaceState as SummaryState & Record<string, unknown>;
    const lastCount = typeof state.autoSummaryMessageCount === 'number' ? state.autoSummaryMessageCount : 0;
    if (messages.length - lastCount < this.minIntervalMessages) {
      return;
    }

    const summary = this.buildSummary(messages.slice(-this.lookbackMessages));
    const summaryFingerprint = this.fingerprint(summary);
    const previousFingerprint = typeof state.autoSummaryFingerprint === 'string' ? state.autoSummaryFingerprint : '';
    const summaryChanged = previousFingerprint !== summaryFingerprint;
    const updatedAt = new Date().toISOString();

    await this.sharedMemoryService.setWorkspaceState(sessionId, {
      ...workspaceState,
      sessionId,
      updatedAt,
      autoSummary: summary,
      autoSummaryUpdatedAt: updatedAt,
      autoSummaryMessageCount: messages.length,
      autoSummaryFingerprint: summaryFingerprint,
    });

    if (!summaryChanged) {
      this.logger.debug(`Auto summary unchanged session=${sessionId}, skip vector indexing`);
      return;
    }
    await this.tryAddSummaryToVector(sessionId, summary, updatedAt, messages.length);

    this.logger.debug(
      `Auto summary generated session=${sessionId} messageCount=${messages.length} lookback=${this.lookbackMessages}`,
    );
  }

  private buildSummary(messages: MemoryMessage[]): string {
    const userTopics = messages
      .filter((item) => item.role === 'user' && item.content.trim().length > 0)
      .slice(-3)
      .map((item) => this.compact(item.content));

    const assistantConclusions = messages
      .filter((item) => item.role === 'assistant' && item.content.trim().length > 0)
      .slice(-3)
      .map((item) => this.compact(item.content));

    const todos = userTopics.filter((line) => /请|需要|TODO|待办|下一步|修复|优化/i.test(line)).slice(-2);

    const lines: string[] = ['会话自动摘要（系统生成）'];
    if (userTopics.length > 0) {
      lines.push(`- 近期用户关注：${userTopics.join(' | ')}`);
    }
    if (assistantConclusions.length > 0) {
      lines.push(`- 近期Agent结论：${assistantConclusions.join(' | ')}`);
    }
    if (todos.length > 0) {
      lines.push(`- 待办线索：${todos.join(' | ')}`);
    }
    if (lines.length === 1) {
      lines.push('- 暂无足够信息。');
    }
    return lines.join('\n');
  }

  private compact(text: string, maxLen = 80): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLen) {
      return normalized;
    }
    return `${normalized.slice(0, maxLen)}...`;
  }

  private async tryAddSummaryToVector(
    sessionId: string,
    summary: string,
    updatedAt: string,
    messageCount: number,
  ): Promise<void> {
    if (!this.chromaService) {
      return;
    }
    try {
      await this.chromaService.addDocument(
        {
          id: `sum_${sessionId}_${messageCount}_${Date.now()}`,
          content: summary,
          metadata: {
            sessionId,
            createdAt: updatedAt,
            source: 'auto_summary',
            messageCount,
          },
        },
        'summaries',
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auto summary vector index failed session=${sessionId} reason=${reason}`);
    }
  }

  private fingerprint(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 33) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }
}
