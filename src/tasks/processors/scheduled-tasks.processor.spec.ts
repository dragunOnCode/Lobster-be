import { ScheduledTasksProcessor } from './scheduled-tasks.processor';

describe('ScheduledTasksProcessor', () => {
  const makeProcessor = (overrides?: Partial<Record<string, any>>) => {
    const queue = {
      isReady: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
      ...overrides?.queue,
    } as any;
    const agentService = { getAllAgents: jest.fn().mockResolvedValue([]), ...overrides?.agentService } as any;
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('./workspace/sessions'),
      get: jest.fn(),
      ...overrides?.configService,
    } as any;
    const workspaceService = { getSessionRoot: jest.fn(), ...overrides?.workspaceService } as any;
    const sessionRepo = { find: jest.fn(), delete: jest.fn(), ...overrides?.sessionRepo } as any;
    const redis = { set: jest.fn(), scan: jest.fn(), del: jest.fn(), ...overrides?.redis } as any;

    return new ScheduledTasksProcessor(queue, agentService, configService, workspaceService, sessionRepo, redis);
  };

  it('onModuleInit 应注册3个定时任务', async () => {
    const queue = {
      isReady: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
    } as any;
    const processor = makeProcessor({ queue });
    await processor.onModuleInit();

    expect(queue.isReady).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add).toHaveBeenNthCalledWith(
      1,
      'check-agents',
      {},
      expect.objectContaining({ jobId: 'cron-check-agents' }),
    );
    expect(queue.add).toHaveBeenNthCalledWith(
      2,
      'cleanup-sessions',
      {},
      expect.objectContaining({ jobId: 'cron-cleanup-sessions' }),
    );
    expect(queue.add).toHaveBeenNthCalledWith(
      3,
      'backup-database',
      {},
      expect.objectContaining({ jobId: 'cron-backup-database' }),
    );
  });

  it('handleHealthCheck 应写入健康状态到Redis', async () => {
    const redis = { set: jest.fn().mockResolvedValue('OK'), scan: jest.fn(), del: jest.fn() } as any;
    const agentService = {
      getAllAgents: jest.fn().mockResolvedValue([
        { id: 'a1', name: 'A1', healthCheck: jest.fn().mockResolvedValue(true) },
        { id: 'a2', name: 'A2', healthCheck: jest.fn().mockResolvedValue(false) },
      ]),
    } as any;
    const processor = makeProcessor({ redis, agentService });
    jest.spyOn<any, any>(processor as any, 'appendSystemTranscript').mockResolvedValue(undefined);

    await processor.handleHealthCheck({ id: 'job-1', name: 'check-agents' } as any);

    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledWith(
      'agents:health:a1',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
    expect(redis.set).toHaveBeenCalledWith(
      'agents:health:a2',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
  });
});
