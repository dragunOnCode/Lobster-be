import { AgentService } from './agent.service';
import { ILLMAdapter } from '../interfaces';

function createAdapter(id: string, name: string): ILLMAdapter {
  return {
    id,
    name,
    model: `${name.toLowerCase()}-model`,
    type: name.toLowerCase(),
    role: 'test',
    capabilities: [],
    callType: 'cli',
    generate: jest.fn(),
    streamGenerate: jest.fn(),
    shouldRespond: jest.fn(),
    healthCheck: jest.fn(),
    getStatus: jest.fn(),
  };
}

describe('AgentService', () => {
  let service: AgentService;
  let eventBus: { subscribe: jest.Mock };

  beforeEach(async () => {
    eventBus = {
      subscribe: jest.fn().mockResolvedValue(undefined),
    };
    service = new AgentService(eventBus as any);
    await service.onModuleInit();
  });

  it('初始化后 agentRegistry 为空（由 AgentConfigService 负责注册）', async () => {
    const all = await service.getAllAgents();
    expect(all).toHaveLength(0);
  });

  it('支持 register/unregister 动态增删', async () => {
    const claude = createAdapter('claude-001', 'Claude');
    service.registerAgent(claude);
    await expect(service.getAgent('claude-001')).resolves.toBe(claude);

    service.unregisterAgent('claude-001');
    await expect(service.getAgent('claude-001')).rejects.toThrow('Agent not found');
  });

  it('getAgentByName 应按名称查找', async () => {
    const gemini = createAdapter('gemini-001', 'Gemini');
    service.registerAgent(gemini);
    await expect(service.getAgentByName('Gemini')).resolves.toBe(gemini);
  });

  it('找不到 agent 时应抛错', async () => {
    await expect(service.getAgent('unknown')).rejects.toThrow('Agent not found');
    await expect(service.getAgentByName('Unknown')).rejects.toThrow('Agent not found by name');
  });

  it('getRegisteredAgentIds 应返回所有已注册 ID', () => {
    const a = createAdapter('a-001', 'A');
    const b = createAdapter('b-001', 'B');
    service.registerAgent(a);
    service.registerAgent(b);
    expect(service.getRegisteredAgentIds()).toEqual(expect.arrayContaining(['a-001', 'b-001']));
  });

  it('onModuleInit 应订阅 workspace:change 事件', () => {
    expect(eventBus.subscribe).toHaveBeenCalledWith('workspace:change', expect.any(Function));
  });
});
