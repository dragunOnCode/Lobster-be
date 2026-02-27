import { ConfigService } from '@nestjs/config';
import { ClaudeAdapter } from '../adapters/claude.adapter';
import { ContextBuilderService } from './context-builder.service';
import { ChatService } from '../../chat/chat.service';
import { CliRunnerService } from './cli-runner.service';
import { SharedMemoryService } from '../../memory/services/shared-memory.service';

type StoredVector = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
};

class InMemoryChromaService {
  private readonly docs: StoredVector[] = [];

  async addDocument(document: {
    id: string;
    content: string;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<void> {
    this.docs.push({
      id: document.id,
      content: document.content,
      metadata: document.metadata ?? {},
    });
  }

  async search(params: {
    query: string;
    sessionId?: string;
    limit?: number;
    minSimilarity?: number;
    collection?: 'messages' | 'summaries';
  }): Promise<Array<{ id: string; content: string; metadata: Record<string, unknown>; similarity: number }>> {
    const { query, sessionId, limit = 10, minSimilarity = 0.7, collection = 'messages' } = params;
    if (collection === 'summaries') {
      return [];
    }

    const queryTokens = this.tokenize(query);
    const candidates = this.docs.filter((item) => !sessionId || item.metadata.sessionId === sessionId);

    const ranked = candidates
      .map((item) => {
        const score = this.score(queryTokens, this.tokenize(item.content));
        return {
          id: item.id,
          content: item.content,
          metadata: item.metadata,
          similarity: score,
        };
      })
      .filter((item) => item.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return ranked;
  }

  private tokenize(text: string): string[] {
    const normalized = text.toLowerCase();
    const terms = normalized.match(/[a-z0-9]+|[\u4e00-\u9fa5]/g) ?? [];
    return terms;
  }

  private score(queryTokens: string[], docTokens: string[]): number {
    if (queryTokens.length === 0 || docTokens.length === 0) {
      return 0;
    }

    const querySet = new Set(queryTokens);
    const docSet = new Set(docTokens);
    let hit = 0;
    for (const token of querySet) {
      if (docSet.has(token)) {
        hit += 1;
      }
    }
    return hit / querySet.size;
  }
}

describe('Semantic Retrieval Integration', () => {
  it('多轮后应把早期事实注入 Claude 提示词', async () => {
    const chromaService = new InMemoryChromaService();

    const shortMemoryStore = new Map<string, any[]>();
    const shortTermMemoryService = {
      append: jest.fn().mockImplementation(async (sessionId: string, message: any) => {
        const list = shortMemoryStore.get(sessionId) ?? [];
        list.push(message);
        shortMemoryStore.set(sessionId, list);
        return list;
      }),
      get: jest.fn().mockImplementation(async (sessionId: string) => shortMemoryStore.get(sessionId) ?? []),
    } as any;

    const sharedMemoryService = {
      getWorkspaceState: jest.fn().mockResolvedValue(null),
    } as any;

    const contextBuilder = new ContextBuilderService(
      chromaService as any,
      shortTermMemoryService,
      sharedMemoryService,
      {
        get: jest.fn().mockReturnValue(undefined),
      } as any,
    );

    const chatService = new ChatService(undefined, undefined, undefined, shortTermMemoryService, chromaService as any);

    await chatService.saveMessage({
      sessionId: 'session-semantic',
      role: 'user',
      content: '我们使用 PostgreSQL 作为关系型数据库，并启用了 pgvector。',
      userId: 'u1',
    });
    await chatService.saveMessage({
      sessionId: 'session-semantic',
      role: 'assistant',
      content: '已记录：数据库是 PostgreSQL。',
      agentId: 'claude-001',
    });
    await chatService.saveMessage({
      sessionId: 'session-semantic',
      role: 'user',
      content: '另外，缓存使用 Redis。',
      userId: 'u1',
    });

    const cliRunner = {
      run: jest.fn().mockResolvedValue({
        stdout: JSON.stringify({ content: 'ok' }),
        stderr: '',
        exitCode: 0,
      }),
    };
    const configService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        const values: Record<string, string> = {
          CLAUDE_CLI_PATH: 'claude',
          CLAUDE_TIMEOUT_MS: '60000',
        };
        return values[key];
      }),
      get: jest.fn().mockReturnValue(undefined),
    };

    const adapter = new ClaudeAdapter(
      cliRunner as unknown as CliRunnerService,
      configService as unknown as ConfigService,
      {
        getAgentThreadBinding: jest.fn().mockResolvedValue(null),
        setAgentThreadBinding: jest.fn().mockResolvedValue(undefined),
      } as unknown as SharedMemoryService,
      contextBuilder,
    );

    await adapter.generate('我们使用什么关系型数据库？', { sessionId: 'session-semantic' });

    const call = cliRunner.run.mock.calls[0][0] as { args: string[] };
    const cliPrompt = call.args[3];
    expect(cliPrompt).toContain('语义相关的历史上下文');
    expect(cliPrompt).toContain('PostgreSQL');
    expect(cliPrompt).toContain('我们使用什么关系型数据库');
  });
});
