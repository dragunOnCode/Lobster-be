import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentsModule } from '../agents/agents.module';
import { SessionEntity } from '../database/entities';
import { MemoryModule } from '../memory/memory.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ScheduledTasksProcessor } from './processors/scheduled-tasks.processor';
import { BackgroundTasksQueue } from './queues/background-tasks.queue';

@Module({
  imports: [
    ConfigModule,
    AgentsModule,
    WorkspaceModule,
    MemoryModule,
    TypeOrmModule.forFeature([SessionEntity]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: Number(configService.getOrThrow<string>('REDIS_PORT')),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          db: Number(configService.get<string>('REDIS_DB') ?? '0'),
        },
      }),
    }),
    BullModule.registerQueue({ name: 'background-tasks' }, { name: 'cron-tasks' }),
  ],
  providers: [ScheduledTasksProcessor, BackgroundTasksQueue],
  exports: [BullModule, BackgroundTasksQueue],
})
export class TasksModule {}
