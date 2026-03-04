import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentContext, Message, SemanticContextItem } from '../interfaces';
import { MemoryMessage, ShortTermMemoryService } from '../../memory/services/short-term-memory.service';
import { SharedMemoryService } from '../../memory/services/shared-memory.service';
import { ChromaService, VectorSearchResult } from '../../vector/services/chroma.service';

export interface BuildContextOptions {
  conversationHistorySource?: 'semantic' | 'short-term-memory' | 'none';
  includeWorkspaceState?: boolean;
}

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);
  private readonly messageLimit: number;
  private readonly messageMinSimilarity: number;
  private readonly summaryLimit: number;
  private readonly summaryMinSimilarity: number;

  constructor(
    private readonly chromaService: ChromaService,
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly sharedMemory: SharedMemoryService,
    private readonly configService: ConfigService,
  ) {
    this.messageLimit = Number(this.configService.get<string>('SEMANTIC_MESSAGE_LIMIT') ?? '5');
    this.messageMinSimilarity = Number(this.configService.get<string>('SEMANTIC_MESSAGE_MIN_SIMILARITY') ?? '0.75');
    this.summaryLimit = Number(this.configService.get<string>('SEMANTIC_SUMMARY_LIMIT') ?? '3');
    this.summaryMinSimilarity = Number(this.configService.get<string>('SEMANTIC_SUMMARY_MIN_SIMILARITY') ?? '0.7');
  }

  async buildContext(
    sessionId: string,
    currentMessage: string,
    userId?: string,
    options?: BuildContextOptions,
  ): Promise<AgentContext> {
    const startedAt = Date.now();
    const resolved = this.resolveOptions(options);
    const [semanticResults, recentMessages, summaries, workspaceState] = await Promise.all([
      this.safeSearch({
        query: currentMessage,
        sessionId,
        limit: this.messageLimit,
        minSimilarity: this.messageMinSimilarity,
        collection: 'messages',
      }),
      this.shortTermMemory.get(sessionId),
      this.safeSearch({
        query: currentMessage,
        sessionId,
        limit: this.summaryLimit,
        minSimilarity: this.summaryMinSimilarity,
        collection: 'summaries',
      }),
      resolved.includeWorkspaceState ? this.sharedMemory.getWorkspaceState(sessionId) : Promise.resolve(null),
    ]);

    const semanticContext = semanticResults.map((item) => this.toSemanticContext(item));
    const semanticHistory = semanticResults.map((item) => this.toMessage(item, sessionId));
    const fallbackHistory = recentMessages.map((item) => this.memoryToMessage(item, sessionId));
    const conversationHistory = this.selectConversationHistory(resolved.conversationHistorySource, semanticHistory, fallbackHistory);
    const conversationSource = this.describeConversationSource(
      resolved.conversationHistorySource,
      semanticHistory.length,
      fallbackHistory.length,
    );
    const topSimilarity =
      semanticContext.length > 0 ? Math.max(...semanticContext.map((item) => item.similarity)).toFixed(3) : 'n/a';

    this.logger.debug(
      `Context built session=${sessionId} source=${conversationSource} semanticHits=${semanticContext.length} summaries=${summaries.length} fallbackMessages=${fallbackHistory.length} topSimilarity=${topSimilarity} thresholds=msg:${this.messageMinSimilarity}/sum:${this.summaryMinSimilarity} buildContextLatencyMs=${Date.now() - startedAt}`,
    );

    return {
      sessionId,
      userId,
      conversationHistory,
      semanticContext,
      summaries: summaries.map((item) => item.content),
      sharedMemory: workspaceState ? { metadata: workspaceState } : undefined,
    };
  }

  private toSemanticContext(item: VectorSearchResult): SemanticContextItem {
    return {
      id: item.id,
      content: item.content,
      similarity: item.similarity,
      timestamp: this.extractTimestamp(item.metadata),
    };
  }

  private toMessage(item: Pick<VectorSearchResult, 'id' | 'content' | 'metadata'>, sessionId: string): Message {
    const roleValue = item.metadata?.role;
    const role: Message['role'] =
      roleValue === 'user' || roleValue === 'assistant' || roleValue === 'system' ? roleValue : 'assistant';
    return {
      id: item.id,
      sessionId,
      role,
      content: item.content,
      agentId: typeof item.metadata?.agentId === 'string' ? item.metadata.agentId : undefined,
      userId: typeof item.metadata?.userId === 'string' ? item.metadata.userId : undefined,
      createdAt: this.extractTimestamp(item.metadata) ? new Date(this.extractTimestamp(item.metadata)!) : undefined,
    };
  }

  private memoryToMessage(item: MemoryMessage, sessionId: string): Message {
    const roleValue = item.role;
    const role: Message['role'] =
      roleValue === 'user' || roleValue === 'assistant' || roleValue === 'system' ? roleValue : 'assistant';

    return {
      id: item.id,
      sessionId,
      role,
      content: item.content,
      agentId: typeof item.agentId === 'string' ? item.agentId : undefined,
      userId: typeof item.userId === 'string' ? item.userId : undefined,
      createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
    };
  }

  private extractTimestamp(metadata: Record<string, unknown> | undefined): string | undefined {
    const value = metadata?.createdAt;
    return typeof value === 'string' ? value : undefined;
  }

  private async safeSearch(params: {
    query: string;
    sessionId: string;
    limit: number;
    minSimilarity: number;
    collection: 'messages' | 'summaries';
  }): Promise<VectorSearchResult[]> {
    try {
      return await this.chromaService.search(params);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Semantic search fallback to memory: ${reason}`);
      return [];
    }
  }

  private resolveOptions(options?: BuildContextOptions): Required<BuildContextOptions> {
    return {
      conversationHistorySource: options?.conversationHistorySource ?? 'semantic',
      includeWorkspaceState: options?.includeWorkspaceState ?? true,
    };
  }

  private selectConversationHistory(
    source: Required<BuildContextOptions>['conversationHistorySource'],
    semanticHistory: Message[],
    fallbackHistory: Message[],
  ): Message[] {
    switch (source) {
      case 'none':
        return [];
      case 'short-term-memory':
        return fallbackHistory;
      case 'semantic':
      default:
        return semanticHistory.length > 0 ? semanticHistory : fallbackHistory;
    }
  }

  private describeConversationSource(
    source: Required<BuildContextOptions>['conversationHistorySource'],
    semanticCount: number,
    fallbackCount: number,
  ): string {
    if (source === 'none') {
      return 'disabled';
    }
    if (source === 'short-term-memory') {
      return 'short-term-memory';
    }
    return semanticCount > 0 ? 'semantic' : fallbackCount > 0 ? 'short-term-memory' : 'empty';
  }
}
