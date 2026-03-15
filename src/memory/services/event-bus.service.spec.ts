import { EventBusService } from './event-bus.service';

describe('EventBusService', () => {
  let redis: any;
  let subscriber: any;
  let service: EventBusService;

  beforeEach(async () => {
    const messageHandlers: Array<(channel: string, message: string) => void> = [];
    subscriber = {
      status: 'ready',
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue('OK'),
      subscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn((event: string, cb: (channel: string, message: string) => void) => {
        if (event === 'message') {
          messageHandlers.push(cb);
        }
      }),
      emitMessage: (channel: string, message: string) => {
        for (const handler of messageHandlers) {
          handler(channel, message);
        }
      },
    };

    redis = {
      publish: jest.fn().mockResolvedValue(1),
      duplicate: jest.fn(() => subscriber),
    };

    service = new EventBusService(redis);
    await service.onModuleInit();
  });

  it('publishWorkspaceChange 应发布 workspace:change 消息', async () => {
    await service.publishWorkspaceChange({
      sessionId: 's1',
      changeType: 'file_updated',
      filePath: 'src/a.ts',
    });

    expect(redis.publish).toHaveBeenCalledWith('workspace:change', expect.stringContaining('"sessionId":"s1"'));
  });

  it('subscribe 后收到消息应触发 handler', async () => {
    const handler = jest.fn();
    await service.subscribe('workspace:change', handler);

    subscriber.emitMessage(
      'workspace:change',
      JSON.stringify({
        sessionId: 's1',
        changeType: 'file_created',
        filePath: 'src/new.ts',
      }),
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        changeType: 'file_created',
      }),
    );
  });
});
