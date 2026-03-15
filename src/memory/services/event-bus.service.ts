import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis.provider';

type EventHandler<T> = (payload: T) => void | Promise<void>;

export interface WorkspaceChangeEvent {
  sessionId: string;
  changeType: 'file_created' | 'file_updated' | 'file_deleted';
  filePath: string;
  timestamp?: string;
}

@Injectable()
export class EventBusService implements OnModuleInit, OnModuleDestroy {
  private subscriber!: Redis;
  private readonly handlers = new Map<string, Set<EventHandler<unknown>>>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.duplicate();
    await this.subscriber.connect();
    this.subscriber.on('message', (channel: string, message: string) => {
      const channelHandlers = this.handlers.get(channel);
      if (!channelHandlers || channelHandlers.size === 0) {
        return;
      }

      let payload: unknown = message;
      try {
        payload = JSON.parse(message);
      } catch {
        // keep raw string payload
      }

      for (const handler of channelHandlers) {
        void Promise.resolve(handler(payload)).catch(() => undefined);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber && this.subscriber.status !== 'end') {
      await this.subscriber.quit();
    }
  }

  async publish<T = unknown>(channel: string, payload: T): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(payload));
  }

  async subscribe<T = unknown>(channel: string, handler: EventHandler<T>): Promise<void> {
    const existing = this.handlers.get(channel) ?? new Set<EventHandler<unknown>>();
    existing.add(handler as EventHandler<unknown>);
    this.handlers.set(channel, existing);
    await this.subscriber.subscribe(channel);
  }

  async publishWorkspaceChange(payload: WorkspaceChangeEvent): Promise<void> {
    await this.publish<WorkspaceChangeEvent>('workspace:change', {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString(),
    });
  }
}
