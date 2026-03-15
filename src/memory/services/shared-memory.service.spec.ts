import { ConfigService } from '@nestjs/config';
import { SharedMemoryService } from './shared-memory.service';

describe('SharedMemoryService', () => {
  let service: SharedMemoryService;
  let redis: { set: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
    };
    const config = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          SHARED_MEMORY_TTL: '3600',
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    service = new SharedMemoryService(redis as any, config);
  });

  it('应写入并读取 workspace state', async () => {
    await service.setWorkspaceState('s1', {
      sessionId: 's1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastUserMessage: 'hello',
    });
    expect(redis.set).toHaveBeenCalledWith('memory:shared:workspace:s1', expect.any(String), 'EX', 3600);

    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        sessionId: 's1',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const state = await service.getWorkspaceState('s1');
    expect(state?.sessionId).toBe('s1');
  });

  it('应写入并读取 agent 决策快照', async () => {
    await service.setDecision('s1', 'claude-001', {
      agentId: 'claude-001',
      should: true,
      reason: 'mentioned',
      priority: 10,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(redis.set).toHaveBeenCalledWith('memory:shared:decision:s1:claude-001', expect.any(String), 'EX', 3600);

    redis.get.mockResolvedValueOnce(
      JSON.stringify({
        agentId: 'claude-001',
        should: true,
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    );
    const decision = await service.getDecision('s1', 'claude-001');
    expect(decision?.agentId).toBe('claude-001');
  });
});
