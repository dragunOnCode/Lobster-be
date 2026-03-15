import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import type { Job, Queue } from 'bull';
import Redis from 'ioredis';
import * as path from 'path';
import { Repository, LessThan } from 'typeorm';
import { AgentService } from '../../agents/services/agent.service';
import { AgentStatus, ILLMAdapter } from '../../agents/interfaces';
import { SessionEntity } from '../../database/entities';
import { REDIS_CLIENT } from '../../memory/redis.provider';
import { WorkspaceService } from '../../workspace/workspace.service';

@Injectable()
@Processor('cron-tasks')
export class ScheduledTasksProcessor implements OnModuleInit {
  private readonly logger = new Logger(ScheduledTasksProcessor.name);
  private readonly workspaceRoot: string;
  private readonly systemTranscriptPath: string;
  private readonly backupDir: string;
  private readonly archiveDir: string;

  constructor(
    @InjectQueue('cron-tasks') private readonly cronQueue: Queue,
    private readonly agentService: AgentService,
    private readonly configService: ConfigService,
    private readonly workspaceService: WorkspaceService,
    @InjectRepository(SessionEntity) private readonly sessionRepo: Repository<SessionEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.workspaceRoot = this.configService.getOrThrow<string>('WORKSPACE_ROOT');
    this.systemTranscriptPath = path.join(this.workspaceRoot, '_system', 'task-transcripts.jsonl');
    this.backupDir = path.join(this.workspaceRoot, '_backups');
    this.archiveDir = path.join(this.workspaceRoot, '_archives');
  }

  async onModuleInit(): Promise<void> {
    await this.cronQueue.isReady();
    await fs.mkdir(path.dirname(this.systemTranscriptPath), { recursive: true });
    await fs.mkdir(this.backupDir, { recursive: true });
    await fs.mkdir(this.archiveDir, { recursive: true });

    await this.cronQueue.add(
      'check-agents',
      {},
      {
        repeat: { cron: '*/5 * * * *' },
        jobId: 'cron-check-agents',
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'fixed', delay: 10_000 },
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
        backoff: { type: 'fixed', delay: 10_000 },
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
        backoff: { type: 'fixed', delay: 10_000 },
      },
    );

    this.logger.log('Cron tasks registered to queue');
  }

  @OnQueueFailed()
  async onJobFailed(job: Job, error: Error): Promise<void> {
    await this.appendSystemTranscript({
      type: 'task_failed',
      jobName: job.name,
      jobId: job.id,
      attemptsMade: job.attemptsMade,
      error: error.message,
    });
  }

  @Process('check-agents')
  async handleHealthCheck(job: Job): Promise<void> {
    const startedAt = Date.now();
    const agents = await this.agentService.getAllAgents();

    const results = await Promise.allSettled(agents.map((agent) => this.checkSingleAgent(agent)));
    const unhealthyCount = results.filter((item) => item.status === 'fulfilled' && !item.value.healthy).length;
    const failedCount = results.filter((item) => item.status === 'rejected').length;

    await this.appendSystemTranscript({
      type: 'health_check_completed',
      durationMs: Date.now() - startedAt,
      totalAgents: agents.length,
      unhealthyCount,
      failedCount,
      jobId: job.id,
    });

    this.logger.log(
      `Health check completed in ${Date.now() - startedAt}ms, total=${agents.length}, unhealthy=${unhealthyCount}, failed=${failedCount}`,
    );
  }

  @Process('cleanup-sessions')
  async handleSessionCleanup(job: Job): Promise<void> {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sessions = await this.sessionRepo.find({
      where: [
        { status: 'active', lastMessageAt: LessThan(cutoffDate) },
        { status: 'active', updatedAt: LessThan(cutoffDate) },
      ],
    });

    let cleaned = 0;
    let failed = 0;

    for (const session of sessions) {
      try {
        await this.archiveSessionWorkspace(session.id);
        await this.clearSessionRedisKeys(session.id);
        await this.sessionRepo.delete(session.id);
        cleaned += 1;
      } catch (error) {
        failed += 1;
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error(`Session cleanup failed for ${session.id}: ${reason}`);
        await this.appendSystemTranscript({
          type: 'session_cleanup_failed',
          sessionId: session.id,
          error: reason,
        });
      }
    }

    await this.appendSystemTranscript({
      type: 'session_cleanup_completed',
      cutoffDate: cutoffDate.toISOString(),
      selected: sessions.length,
      cleaned,
      failed,
      jobId: job.id,
    });
  }

  @Process('backup-database')
  async handleDatabaseBackup(job: Job): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.backupDir, `db-backup-${timestamp}.sql`);
    await this.runPgDump(backupFile);
    await this.cleanOldBackups(7);

    await this.appendSystemTranscript({
      type: 'database_backup_completed',
      backupFile,
      jobId: job.id,
    });
  }

  private async checkSingleAgent(agent: ILLMAdapter): Promise<{ agentId: string; healthy: boolean }> {
    const healthy = await agent.healthCheck();
    const status = healthy ? AgentStatus.ONLINE : AgentStatus.OFFLINE;
    const key = `agents:health:${agent.id}`;

    await this.redis.set(
      key,
      JSON.stringify({
        agentId: agent.id,
        agentName: agent.name,
        healthy,
        status,
        checkedAt: new Date().toISOString(),
      }),
      'EX',
      60 * 30,
    );

    if (!healthy) {
      this.logger.warn(`Agent unhealthy: ${agent.id} (${agent.name})`);
      await this.appendSystemTranscript({
        type: 'agent_unhealthy',
        agentId: agent.id,
        agentName: agent.name,
      });
    }

    return { agentId: agent.id, healthy };
  }

  private async archiveSessionWorkspace(sessionId: string): Promise<void> {
    const sessionRoot = this.workspaceService.getSessionRoot(sessionId);
    const archivePath = path.join(this.archiveDir, `${sessionId}-${Date.now()}`);

    try {
      await fs.access(sessionRoot);
    } catch {
      return;
    }

    await fs.cp(sessionRoot, archivePath, { recursive: true });
    await fs.rm(sessionRoot, { recursive: true, force: true });
  }

  private async clearSessionRedisKeys(sessionId: string): Promise<void> {
    const pattern = `*${sessionId}*`;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  private async runPgDump(outputFile: string): Promise<void> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const host = this.configService.getOrThrow<string>('DB_HOST');
    const port = this.configService.getOrThrow<string>('DB_PORT');
    const username = this.configService.getOrThrow<string>('DB_USERNAME');
    const password = this.configService.getOrThrow<string>('DB_PASSWORD');
    const database = this.configService.getOrThrow<string>('DB_DATABASE');
    const pgDumpPath = this.configService.get<string>('PG_DUMP_PATH') ?? 'pg_dump';

    await execFileAsync(pgDumpPath, ['-h', host, '-p', port, '-U', username, '-d', database, '-f', outputFile], {
      env: { ...process.env, PGPASSWORD: password },
    });
  }

  private async cleanOldBackups(retentionDays: number): Promise<void> {
    const files = await fs.readdir(this.backupDir);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    await Promise.all(
      files.map(async (name) => {
        const fullPath = path.join(this.backupDir, name);
        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(fullPath, { force: true });
        }
      }),
    );
  }

  private async appendSystemTranscript(event: Record<string, unknown>): Promise<void> {
    const payload = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    await fs.appendFile(this.systemTranscriptPath, `${JSON.stringify(payload)}\n`, 'utf-8');
  }
}
