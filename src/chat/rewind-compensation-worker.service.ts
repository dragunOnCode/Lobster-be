import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { ChatService } from './chat.service';
import { RewindDerivedSyncPayload } from './rewind-compensation-queue.service';

@Injectable()
export class RewindCompensationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RewindCompensationWorkerService.name);
  private worker?: Worker<RewindDerivedSyncPayload>;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<RewindDerivedSyncPayload>(
      'rewind-compensation',
      async (job: Job<RewindDerivedSyncPayload>) => {
        if (job.name !== 'rewind.derived_sync') {
          return;
        }
        const { sessionId, anchorMessageId } = job.data;
        this.logger.warn(
          `worker start derived-sync compensation jobId=${job.id} attempt=${job.attemptsMade + 1} session=${sessionId} anchor=${anchorMessageId}`,
        );
        await this.chatService.rebuildDerivedStateAfterRewind(sessionId, anchorMessageId, 'worker');
      },
      {
        connection: {
          host: this.configService.getOrThrow<string>('REDIS_HOST'),
          port: Number(this.configService.getOrThrow<string>('REDIS_PORT')),
          password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
          db: Number(this.configService.get<string>('REDIS_DB') ?? '0'),
        },
        concurrency: 2,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`worker completed derived-sync jobId=${job.id}`);
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `worker failed derived-sync jobId=${job?.id ?? 'unknown'} attempts=${job?.attemptsMade ?? 0} reason=${error.message}`,
      );
    });

    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) {
      return;
    }
    await this.worker.close();
  }
}
