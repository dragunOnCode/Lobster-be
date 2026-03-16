import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';

export interface RewindDerivedSyncPayload {
  sessionId: string;
  anchorMessageId: string;
  requestedAt: string;
  attemptSource: 'service' | 'worker';
}

@Injectable()
export class RewindCompensationQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(RewindCompensationQueueService.name);
  private readonly queue: Queue<RewindDerivedSyncPayload>;
  private readonly defaultJobOptions: JobsOptions = {
    attempts: 6,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 1000,
    removeOnFail: false,
  };

  constructor(private readonly configService: ConfigService) {
    this.queue = new Queue<RewindDerivedSyncPayload>('rewind-compensation', {
      connection: {
        host: this.configService.getOrThrow<string>('REDIS_HOST'),
        port: Number(this.configService.getOrThrow<string>('REDIS_PORT')),
        password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
        db: Number(this.configService.get<string>('REDIS_DB') ?? '0'),
      },
      defaultJobOptions: this.defaultJobOptions,
    });
  }

  async enqueueDerivedSync(payload: RewindDerivedSyncPayload): Promise<void> {
    const jobId = `rewind:${payload.sessionId}:${payload.anchorMessageId}`;
    await this.queue.add('rewind.derived_sync', payload, {
      ...this.defaultJobOptions,
      jobId,
    });
    this.logger.warn(
      `enqueue derived-sync compensation jobId=${jobId} session=${payload.sessionId} anchor=${payload.anchorMessageId}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
