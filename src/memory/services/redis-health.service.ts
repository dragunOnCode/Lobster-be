import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis.provider';

@Injectable()
export class RedisHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisHealthService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    await this.redis.connect();
    const pong = await this.redis.ping();
    if (pong !== 'PONG') {
      throw new Error(`Redis ping failed, expected PONG but got: ${pong}`);
    }
    this.logger.log('Redis connection verified by ping/pong');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }
}
