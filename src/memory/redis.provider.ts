import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export type RedisClient = Redis;

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): RedisClient => {
    const host = configService.getOrThrow<string>('REDIS_HOST');
    const port = Number(configService.getOrThrow<string>('REDIS_PORT'));
    const password = configService.get<string>('REDIS_PASSWORD') || undefined;
    const db = Number(configService.get<string>('REDIS_DB') ?? '0');

    return new Redis({
      host,
      port,
      password,
      db,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  },
};
