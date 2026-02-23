import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobOptions, Queue } from 'bull';

@Injectable()
export class BackgroundTasksQueue implements OnModuleInit {
  private readonly logger = new Logger(BackgroundTasksQueue.name);

  constructor(@InjectQueue('background-tasks') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.isReady();
    this.logger.log('Background task queue is ready');
  }

  async enqueue<T = Record<string, unknown>>(
    name: string,
    payload: T,
    options?: JobOptions,
  ): Promise<void> {
    await this.queue.add(name, payload, {
      removeOnComplete: true,
      attempts: 3,
      ...options,
    });
  }
}
