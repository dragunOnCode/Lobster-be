import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { ChatService } from './chat.service';
import {
  DeleteSessionPayload,
  PersistMessagePayload,
  RewindDerivedSyncPayload,
  RewindMainFactPayload,
} from './rewind-compensation-queue.service';

@Injectable()
export class RewindCompensationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RewindCompensationWorkerService.name);
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      'rewind-compensation',
      async (job: Job) => {
        if (job.name === 'rewind.derived_sync') {
          const { sessionId, anchorMessageId } = job.data as RewindDerivedSyncPayload;
          this.logger.warn(
            `worker start derived-sync compensation jobId=${job.id} attempt=${job.attemptsMade + 1} session=${sessionId} anchor=${anchorMessageId}`,
          );
          await this.chatService.rebuildDerivedStateAfterRewind(sessionId, anchorMessageId, 'worker');
          return;
        }

        if (job.name === 'rewind.main_fact') {
          const { sessionId, anchorMessageId } = job.data as RewindMainFactPayload;
          this.logger.warn(
            `worker start rewind-main compensation jobId=${job.id} attempt=${job.attemptsMade + 1} session=${sessionId} anchor=${anchorMessageId}`,
          );
          await this.chatService.retryRewindFromQueue(sessionId, anchorMessageId);
          return;
        }

        if (job.name === 'chat.persist_message') {
          const payload = job.data as PersistMessagePayload;
          this.logger.warn(
            `worker start persist-message compensation jobId=${job.id} attempt=${job.attemptsMade + 1} session=${payload.sessionId} role=${payload.role}`,
          );
          await this.chatService.persistMessageFromQueue(payload);
          return;
        }

        if (job.name === 'chat.delete_session') {
          const payload = job.data as DeleteSessionPayload;
          this.logger.warn(
            `worker start delete-session compensation jobId=${job.id} attempt=${job.attemptsMade + 1} session=${payload.sessionId}`,
          );
          await this.chatService.retryDeleteSessionFromQueue(payload.sessionId);
          return;
        }

        this.logger.warn(`worker skip unknown compensation job name=${job.name} id=${job.id}`);
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
      this.logger.log(`worker completed compensation job name=${job.name} jobId=${job.id}`);
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `worker failed compensation job name=${job?.name ?? 'unknown'} jobId=${job?.id ?? 'unknown'} attempts=${job?.attemptsMade ?? 0} reason=${error.message}`,
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
