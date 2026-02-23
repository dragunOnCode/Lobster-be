import { BackgroundTasksQueue } from './background-tasks.queue';

describe('BackgroundTasksQueue', () => {
  it('onModuleInit 应等待队列就绪', async () => {
    const queue = {
      isReady: jest.fn().mockResolvedValue(undefined),
      add: jest.fn(),
    } as any;

    const service = new BackgroundTasksQueue(queue);
    await service.onModuleInit();

    expect(queue.isReady).toHaveBeenCalled();
  });

  it('enqueue 应添加任务并附加默认选项', async () => {
    const queue = {
      isReady: jest.fn(),
      add: jest.fn().mockResolvedValue(undefined),
    } as any;

    const service = new BackgroundTasksQueue(queue);
    await service.enqueue('demo', { foo: 'bar' }, { priority: 1 });

    expect(queue.add).toHaveBeenCalledWith(
      'demo',
      { foo: 'bar' },
      expect.objectContaining({
        removeOnComplete: true,
        attempts: 3,
        priority: 1,
      }),
    );
  });
});
