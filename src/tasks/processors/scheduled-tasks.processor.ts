import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bull';

@Injectable()
@Processor('cron-tasks')
export class ScheduledTasksProcessor implements OnModuleInit {
  private readonly logger = new Logger(ScheduledTasksProcessor.name);

  constructor(@InjectQueue('cron-tasks') private readonly cronQueue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.cronQueue.isReady();

    await this.cronQueue.add(
      'check-agents',
      {},
      {
        repeat: { cron: '*/5 * * * *' },
        jobId: 'cron-check-agents',
        removeOnComplete: true,
        attempts: 3,
      },
    );

    await this.cronQueue.add(
      'cleanup-sessions',
      {},
      {
        repeat: { cron: '0 2 * * *' },
        jobId: 'cron-cleanup-sessions',
        removeOnComplete: true,
        attempts: 3,
      },
    );

    await this.cronQueue.add(
      'backup-database',
      {},
      {
        repeat: { cron: '0 3 * * *' },
        jobId: 'cron-backup-database',
        removeOnComplete: true,
        attempts: 3,
      },
    );

    this.logger.log('Cron tasks registered to queue');
  }

  @Process('check-agents')
  async handleHealthCheck(job: Job): Promise<void> {
    this.logger.debug(`Handling job ${job.name}:${job.id}`);
  }

  @Process('cleanup-sessions')
  async handleSessionCleanup(job: Job): Promise<void> {
    this.logger.debug(`Handling job ${job.name}:${job.id}`);
  }

  @Process('backup-database')
  async handleDatabaseBackup(job: Job): Promise<void> {
    this.logger.debug(`Handling job ${job.name}:${job.id}`);
  }
}
