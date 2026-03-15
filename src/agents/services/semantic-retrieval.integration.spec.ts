import { ConfigService } from '@nestjs/config';
import { ClaudeAdapter } from '../adapters/claude.adapter';
import { ContextBuilderService } from './context-builder.service';
import { ChatService } from '../../chat/chat.service';
import { CliRunnerService } from './cli-runner.service';
import { PromptContextBuilderService } from './prompt-context-builder.service';

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

    return candidates
      .map((item) => ({
        id: item.id,
        content: item.content,
        metadata: item.metadata,
        similarity: this.score(queryTokens, this.tokenize(item.content)),
      }))
      .filter((item) => item.similarity >= minSimilarity)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit);
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]/g) ?? [];
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
  it('injects early semantic facts when the adapter receives prebuilt context', async () => {
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
      content: 'We use PostgreSQL as the relational database and enable pgvector.',
      userId: 'u1',
    });
    await chatService.saveMessage({
      sessionId: 'session-semantic',
      role: 'assistant',
      content: 'Recorded: the database is PostgreSQL.',
      agentId: 'claude-001',
    });
    await chatService.saveMessage({
      sessionId: 'session-semantic',
      role: 'user',
      content: 'In addition, Redis is used for caching.',
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

    const promptContextBuilder = new PromptContextBuilderService({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);
    const adapter = new ClaudeAdapter(
      cliRunner as unknown as CliRunnerService,
      configService as unknown as ConfigService,
      promptContextBuilder,
    );
    const question = 'Which database is PostgreSQL in our stack?';
    const context = await contextBuilder.buildContext('session-semantic', question);

    await adapter.generate(question, context);

    const call = cliRunner.run.mock.calls[0][0] as { args: string[] };
    const promptIndex = call.args.findIndex((arg) => arg === '-p');
    const cliPrompt = call.args[promptIndex + 1];
    expect(cliPrompt).toContain('## conversation');
    expect(cliPrompt).toContain('PostgreSQL');
    expect(cliPrompt).toContain('## user_intent');
    expect(cliPrompt).toContain(question);
  });
});
