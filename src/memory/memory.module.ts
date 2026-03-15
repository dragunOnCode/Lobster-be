import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { redisProvider, REDIS_CLIENT } from './redis.provider';
import { EventBusService } from './services/event-bus.service';
import { RedisHealthService } from './services/redis-health.service';
import { ShortTermMemoryService } from './services/short-term-memory.service';
import { SharedMemoryService } from './services/shared-memory.service';

@Module({
  imports: [ConfigModule],
  providers: [redisProvider, RedisHealthService, ShortTermMemoryService, SharedMemoryService, EventBusService],
  exports: [REDIS_CLIENT, ShortTermMemoryService, SharedMemoryService, EventBusService],
})
export class MemoryModule {}
