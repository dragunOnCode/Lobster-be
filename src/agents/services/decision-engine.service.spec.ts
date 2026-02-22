import { AgentContext, ILLMAdapter, Message } from '../interfaces';
import { DecisionEngineService } from './decision-engine.service';

function createAgent(id: string, name: string, shouldRespond: ILLMAdapter['shouldRespond']): ILLMAdapter {
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
    shouldRespond,
    healthCheck: jest.fn(),
    getStatus: jest.fn(),
  };
}

describe('DecisionEngineService', () => {
  const service = new DecisionEngineService();
  const baseMessage: Message = { id: 'm1', sessionId: 's1', role: 'user', content: 'hello world' };
  const baseContext: AgentContext = { sessionId: 's1' };

  it('无@提及时应并行决策并按优先级排序', async () => {
    const a1 = createAgent('a1-001', 'A1', async () => ({ should: true, priority: 'medium', reason: 'kw' }));
    const a2 = createAgent('a2-001', 'A2', async () => ({ should: true, priority: 'high', reason: 'mention-like' }));

    const decisions = await service.decideResponders(baseMessage, [a1, a2], baseContext);

    expect(decisions).toHaveLength(2);
    expect(decisions[0].agent.id).toBe('a2-001');
    expect(decisions[1].agent.id).toBe('a1-001');
  });

  it('@提及时应仅提及Agent响应', async () => {
    const claude = createAgent('claude-001', 'Claude', async () => ({ should: false }));
    const codex = createAgent('codex-001', 'Codex', async () => ({ should: true, priority: 'high' }));
    const message: Message = { ...baseMessage, content: '@Claude 帮我看看' };

    const decisions = await service.decideAll(message, [claude, codex], baseContext);

    const shouldMap = Object.fromEntries(decisions.map((d) => [d.agent.id, d.should]));
    expect(shouldMap['claude-001']).toBe(true);
    expect(shouldMap['codex-001']).toBe(false);
  });

  it('单个Agent超时不应阻塞其他Agent', async () => {
    const timeoutAgent = createAgent('slow-001', 'Slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return { should: true, priority: 'high' };
    });
    const fastAgent = createAgent('fast-001', 'Fast', async () => ({ should: true, priority: 'medium' }));

    const decisions = await service.decideAll(baseMessage, [timeoutAgent, fastAgent], baseContext);
    const fast = decisions.find((item) => item.agent.id === 'fast-001');
    const slow = decisions.find((item) => item.agent.id === 'slow-001');

    expect(fast?.should).toBe(true);
    expect(slow?.should).toBe(false);
    expect(slow?.reason).toContain('timeout');
  });

  it('无人响应时 decideResponders 返回空数组', async () => {
    const a1 = createAgent('a1-001', 'A1', async () => ({ should: false }));
    const a2 = createAgent('a2-001', 'A2', async () => ({ should: false }));

    const decisions = await service.decideResponders(baseMessage, [a1, a2], baseContext);
    expect(decisions).toEqual([]);
  });
});
