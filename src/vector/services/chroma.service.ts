import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, Collection, IncludeEnum } from 'chromadb';
import { EmbeddingService } from './embedding.service';

export interface VectorDocument {
  id: string;
  content: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface VectorSearchParams {
  query: string;
  sessionId?: string;
  limit?: number;
  minSimilarity?: number;
  collection?: 'messages' | 'summaries';
}

export interface VectorSearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

@Injectable()
export class ChromaService implements OnModuleInit {
  private readonly logger = new Logger(ChromaService.name);
  private client!: ChromaClient;
  private messagesCollection!: Collection;
  private summariesCollection!: Collection;

  constructor(
    private readonly configService: ConfigService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async onModuleInit(): Promise<void> {
    const host = this.configService.get<string>('CHROMA_HOST') ?? 'localhost';
    const port = this.configService.get<string>('CHROMA_PORT') ?? '8000';
    const url = this.configService.get<string>('CHROMA_URL') ?? `http://${host}:${port}`;

    this.client = new ChromaClient({ path: url });
    this.messagesCollection = await this.client.getOrCreateCollection({
      name: 'messages',
      metadata: { 'hnsw:space': 'cosine' },
    });
    this.summariesCollection = await this.client.getOrCreateCollection({
      name: 'summaries',
      metadata: { 'hnsw:space': 'cosine' },
    });
    this.logger.log(`ChromaDB connected: ${url}`);
  }

  async addDocument(document: VectorDocument, collection: 'messages' | 'summaries' = 'messages'): Promise<void> {
    const embedding = await this.embeddingService.embed(document.content);
    const target = this.getCollection(collection);
    await target.add({
      ids: [document.id],
      embeddings: [embedding],
      documents: [document.content],
      metadatas: [document.metadata ?? {}],
    });
  }

  async addDocuments(documents: VectorDocument[], collection: 'messages' | 'summaries' = 'messages'): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    const target = this.getCollection(collection);
    const embeddings = await this.embeddingService.embedBatch(documents.map((item) => item.content));
    await target.add({
      ids: documents.map((item) => item.id),
      documents: documents.map((item) => item.content),
      embeddings,
      metadatas: documents.map((item) => item.metadata ?? {}),
    });
  }

  async search(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const { query, sessionId, limit = 10, minSimilarity = 0.7, collection = 'messages' } = params;
    const queryEmbedding = await this.embeddingService.embed(query);
    const target = this.getCollection(collection);
    const queryResult = await target.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      where: sessionId ? ({ sessionId } as Record<string, string>) : undefined,
      include: [IncludeEnum.documents, IncludeEnum.metadatas, IncludeEnum.distances],
    });

    const ids = queryResult.ids?.[0] ?? [];
    const documents = queryResult.documents?.[0] ?? [];
    const metadatas = queryResult.metadatas?.[0] ?? [];
    const distances = queryResult.distances?.[0] ?? [];

    return ids
      .map((id, index) => {
        const distance = distances[index] ?? 1;
        const similarity = 1 - distance;
        return {
          id,
          content: documents[index] ?? '',
          metadata: (metadatas[index] as Record<string, unknown>) ?? {},
          similarity,
        };
      })
      .filter((item) => item.similarity >= minSimilarity);
  }

  async deleteBySessionId(sessionId: string): Promise<void> {
    await this.messagesCollection.delete({ where: { sessionId } as Record<string, string> });
    await this.summariesCollection.delete({ where: { sessionId } as Record<string, string> });
  }

  private getCollection(collection: 'messages' | 'summaries'): Collection {
    return collection === 'summaries' ? this.summariesCollection : this.messagesCollection;
  }
}
