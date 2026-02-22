import { RedisHealthService } from './redis-health.service';

describe('RedisHealthService', () => {
  it('onModuleInit 应执行 ping/pong 检查', async () => {
    const redis = {
      connect: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue('OK'),
      status: 'ready',
    } as any;

    const service = new RedisHealthService(redis);
    await service.onModuleInit();

    expect(redis.connect).toHaveBeenCalled();
    expect(redis.ping).toHaveBeenCalled();
  });

  it('onModuleDestroy 应退出连接', async () => {
    const redis = {
      connect: jest.fn(),
      ping: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
      status: 'ready',
    } as any;

    const service = new RedisHealthService(redis);
    await service.onModuleDestroy();

    expect(redis.quit).toHaveBeenCalled();
  });
});
