import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT } from '../redis.provider';
import Redis from 'ioredis';

export interface MemoryMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
  [key: string]: unknown;
}

@Injectable()
export class ShortTermMemoryService {
  private readonly logger = new Logger(ShortTermMemoryService.name);
  private readonly ttlSeconds: number;
  private readonly maxSize: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.ttlSeconds = Number(this.configService.getOrThrow<string>('SHORT_TERM_MEMORY_TTL'));
    this.maxSize = Number(this.configService.getOrThrow<string>('SHORT_TERM_MEMORY_SIZE'));
    this.logger.log(`ShortTermMemoryService initialized: ttl=${this.ttlSeconds}s, maxSize=${this.maxSize}`);
  }

  // 每次用户发送消息后，保存到短期记忆
  // 格式为session: json格式的maxSize条消息
  async save(sessionId: string, messages: MemoryMessage[]): Promise<void> {
    const key = this.getKey(sessionId);
    const normalized = messages.slice(-this.maxSize);
    this.logger.debug(`[save] key=${key}, count=${normalized.length}`);
    try {
      const result = await this.redis.set(key, JSON.stringify(normalized), 'EX', this.ttlSeconds);
      this.logger.log(`[save] SUCCESS key=${key}, count=${normalized.length}, result=${result}`);
    } catch (error) {
      this.logger.error(`[save] FAILED key=${key}, error=${error}`);
      throw error;
    }
  }

  async get(sessionId: string): Promise<MemoryMessage[]> {
    const key = this.getKey(sessionId);
    this.logger.debug(`[get] key=${key}`);
    try {
      const raw = await this.redis.get(key);
      if (!raw) {
        this.logger.log(`[get] MISS key=${key}, count=0`);
        return [];
      }
      const parsed = JSON.parse(raw) as MemoryMessage[];
      const result = parsed.slice(-this.maxSize);
      this.logger.log(`[get] HIT key=${key}, count=${result.length}`);
      return result;
    } catch (error) {
      this.logger.error(`[get] FAILED key=${key}, error=${error}`);
      return [];
    }
  }

  async append(sessionId: string, message: MemoryMessage): Promise<MemoryMessage[]> {
    this.logger.log(`[append] START sessionId=${sessionId}, messageId=${message.id}`);
    const existing = await this.get(sessionId);
    this.logger.debug(`[append] existing count=${existing.length}`);
    const next = [...existing, message].slice(-this.maxSize);
    this.logger.debug(`[append] next count=${next.length}`);
    await this.save(sessionId, next);
    this.logger.log(`[append] SUCCESS sessionId=${sessionId}, messageId=${message.id}, totalCount=${next.length}`);
    return next;
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(this.getKey(sessionId));
  }

  private getKey(sessionId: string): string {
    return `memory:short:${sessionId}`;
  }
}
