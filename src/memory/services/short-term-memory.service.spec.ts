import { ConfigService } from '@nestjs/config';
import { ShortTermMemoryService } from './short-term-memory.service';

describe('ShortTermMemoryService', () => {
  let service: ShortTermMemoryService;
  let redis: { set: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
    };
    const config = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          SHORT_TERM_MEMORY_TTL: '300',
          SHORT_TERM_MEMORY_SIZE: '3',
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    service = new ShortTermMemoryService(redis as any, config);
  });

  it('save 应截断到最近 N 条并设置 TTL', async () => {
    const messages = [
      { id: '1', sessionId: 's1', role: 'user', content: 'a', createdAt: 't1' },
      { id: '2', sessionId: 's1', role: 'user', content: 'b', createdAt: 't2' },
      { id: '3', sessionId: 's1', role: 'user', content: 'c', createdAt: 't3' },
      { id: '4', sessionId: 's1', role: 'user', content: 'd', createdAt: 't4' },
    ];

    await service.save('s1', messages);

    expect(redis.set).toHaveBeenCalledWith('memory:short:s1', JSON.stringify(messages.slice(-3)), 'EX', 300);
  });

  it('append 应追加并维持最近 N 条', async () => {
    redis.get.mockResolvedValue(
      JSON.stringify([
        { id: '1', sessionId: 's1', role: 'user', content: 'a', createdAt: 't1' },
        { id: '2', sessionId: 's1', role: 'user', content: 'b', createdAt: 't2' },
        { id: '3', sessionId: 's1', role: 'user', content: 'c', createdAt: 't3' },
      ]),
    );

    const list = await service.append('s1', {
      id: '4',
      sessionId: 's1',
      role: 'assistant',
      content: 'd',
      createdAt: 't4',
    });

    expect(list.map((i) => i.id)).toEqual(['2', '3', '4']);
  });
});
