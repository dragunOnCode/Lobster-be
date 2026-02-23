import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private openaiClient: OpenAI | null = null;
  private readonly provider: 'ollama' | 'openai';
  private readonly openaiModel: string;
  private readonly ollamaModel: string;
  private readonly ollamaBaseUrl: string;
  private readonly batchSize: number;

  constructor(private readonly configService: ConfigService) {
    const providerRaw = (this.configService.get<string>('EMBEDDING_PROVIDER') ?? 'ollama').toLowerCase();
    this.provider = providerRaw === 'openai' ? 'openai' : 'ollama';
    this.openaiModel = this.configService.get<string>('OPENAI_EMBEDDING_MODEL') ?? 'text-embedding-3-small';
    this.ollamaModel = this.configService.get<string>('OLLAMA_EMBEDDING_MODEL') ?? 'nomic-embed-text';
    this.ollamaBaseUrl = (this.configService.get<string>('OLLAMA_BASE_URL') ?? 'http://localhost:11434').replace(
      /\/$/,
      '',
    );
    this.batchSize = Number(
      this.configService.get<string>('EMBEDDING_BATCH_SIZE') ??
        this.configService.get<string>('OPENAI_EMBEDDING_BATCH_SIZE') ??
        '50',
    );
  }

  async embed(text: string): Promise<number[]> {
    const input = text.trim();
    if (!input) {
      return [];
    }
    const [embedding] = await this.embedByProvider([input]);
    return embedding ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const normalized = texts.map((item) => item.trim());
    return this.embedByProvider(normalized);
  }

  private async embedByProvider(texts: string[]): Promise<number[][]> {
    if (this.provider === 'openai') {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        this.logger.warn('OPENAI_API_KEY not found, fallback to ollama embeddings');
        return this.embedWithOllama(texts);
      }
      return this.embedWithOpenAI(texts, apiKey);
    }
    return this.embedWithOllama(texts);
  }

  private async embedWithOpenAI(texts: string[], apiKey: string): Promise<number[][]> {
    const client = this.getOpenAIClient(apiKey);
    const results: number[][] = [];
    for (let index = 0; index < texts.length; index += this.batchSize) {
      const chunk = texts.slice(index, index + this.batchSize);
      const response = await client.embeddings.create({
        model: this.openaiModel,
        input: chunk,
      });
      for (const row of response.data) {
        results.push(row.embedding ?? []);
      }
    }
    return results;
  }

  private async embedWithOllama(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.ollamaBaseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.ollamaModel,
        input: texts,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama embedding failed: ${response.status} ${errorText}`);
    }

    const payload = (await response.json()) as {
      embeddings?: number[][];
      embedding?: number[];
    };
    if (Array.isArray(payload.embeddings)) {
      return payload.embeddings;
    }
    if (Array.isArray(payload.embedding)) {
      return [payload.embedding];
    }
    throw new Error('Ollama embedding response is invalid');
  }

  private getOpenAIClient(apiKey: string): OpenAI {
    if (!this.openaiClient) {
      this.openaiClient = new OpenAI({ apiKey });
    }
    return this.openaiClient;
  }
}
