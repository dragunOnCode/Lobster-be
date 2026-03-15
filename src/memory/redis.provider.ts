import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export type RedisClient = Redis;

const logger = new Logger('RedisProvider');

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): RedisClient => {
    const host = configService.getOrThrow<string>('REDIS_HOST');
    const port = Number(configService.getOrThrow<string>('REDIS_PORT'));
    const password = configService.get<string>('REDIS_PASSWORD') || undefined;
    const db = Number(configService.get<string>('REDIS_DB') ?? '0');

    logger.log(`Creating Redis connection: host=${host}, port=${port}, db=${db}, hasPassword=${!!password}`);

    const client = new Redis({
      host,
      port,
      password,
      db,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    client.on('connect', () => {
      logger.log(`Redis connected: host=${host}, port=${port}, db=${db}`);
    });

    client.on('error', (err) => {
      logger.error(`Redis error: ${err}`);
    });

    return client;
  },
};
