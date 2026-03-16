import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';

export interface RewindDerivedSyncPayload {
  sessionId: string;
  anchorMessageId: string;
  requestedAt: string;
  attemptSource: 'service' | 'worker';
}

export interface RewindMainFactPayload {
  sessionId: string;
  anchorMessageId: string;
  requestedAt: string;
  attemptSource: 'service' | 'worker';
}

export interface PersistMessagePayload {
  sessionId: string;
  userId?: string;
  agentId?: string;
  agentName?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mentionedAgents?: string[];
  requestedAt: string;
  attemptSource: 'service' | 'worker';
}

export interface DeleteSessionPayload {
  sessionId: string;
  requestedAt: string;
  attemptSource: 'service' | 'worker';
}

@Injectable()
export class RewindCompensationQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(RewindCompensationQueueService.name);
  private readonly queue: Queue;
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
    this.queue = new Queue('rewind-compensation', {
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

  async enqueueRewindMainFact(payload: RewindMainFactPayload): Promise<void> {
    const jobId = `rewind-main:${payload.sessionId}:${payload.anchorMessageId}`;
    await this.queue.add('rewind.main_fact', payload, {
      ...this.defaultJobOptions,
      jobId,
    });
    this.logger.warn(
      `enqueue rewind-main compensation jobId=${jobId} session=${payload.sessionId} anchor=${payload.anchorMessageId}`,
    );
  }

  async enqueuePersistMessage(payload: PersistMessagePayload): Promise<void> {
    const timestamp = payload.requestedAt.replace(/[:.]/g, '-');
    const preview = payload.content.slice(0, 32).replace(/\s+/g, '_');
    const jobId = `persist-msg:${payload.sessionId}:${payload.role}:${timestamp}:${preview}`;
    await this.queue.add('chat.persist_message', payload, {
      ...this.defaultJobOptions,
      jobId,
    });
    this.logger.warn(
      `enqueue persist-message compensation jobId=${jobId} session=${payload.sessionId} role=${payload.role}`,
    );
  }

  async enqueueDeleteSession(payload: DeleteSessionPayload): Promise<void> {
    const jobId = `delete-session:${payload.sessionId}`;
    await this.queue.add('chat.delete_session', payload, {
      ...this.defaultJobOptions,
      jobId,
    });
    this.logger.warn(`enqueue delete-session compensation jobId=${jobId} session=${payload.sessionId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
