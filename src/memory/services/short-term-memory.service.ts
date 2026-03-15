import { Inject, Injectable } from '@nestjs/common';
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
  private readonly ttlSeconds: number;
  private readonly maxSize: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.ttlSeconds = Number(this.configService.getOrThrow<string>('SHORT_TERM_MEMORY_TTL'));
    this.maxSize = Number(this.configService.getOrThrow<string>('SHORT_TERM_MEMORY_SIZE'));
  }

  // 每次用户发送消息后，保存到短期记忆
  // 格式为session: json格式的maxSize条消息
  async save(sessionId: string, messages: MemoryMessage[]): Promise<void> {
    const key = this.getKey(sessionId);
    const normalized = messages.slice(-this.maxSize);
    await this.redis.set(key, JSON.stringify(normalized), 'EX', this.ttlSeconds);
  }

  async get(sessionId: string): Promise<MemoryMessage[]> {
    const key = this.getKey(sessionId);
    const raw = await this.redis.get(key);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as MemoryMessage[];
      return parsed.slice(-this.maxSize);
    } catch {
      return [];
    }
  }

  async append(sessionId: string, message: MemoryMessage): Promise<MemoryMessage[]> {
    const existing = await this.get(sessionId);
    const next = [...existing, message].slice(-this.maxSize);
    await this.save(sessionId, next);
    return next;
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(this.getKey(sessionId));
  }

  private getKey(sessionId: string): string {
    return `memory:short:${sessionId}`;
  }
}
