import { ScheduledTasksProcessor } from './scheduled-tasks.processor';

describe('ScheduledTasksProcessor', () => {
  it('onModuleInit 应注册3个定时任务', async () => {
    const queue = {
      isReady: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
    } as any;

    const processor = new ScheduledTasksProcessor(queue);
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
});
