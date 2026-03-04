import { AgentHandoffService } from './agent-handoff.service';

describe('AgentHandoffService', () => {
  let service: AgentHandoffService;

  beforeEach(() => {
    service = new AgentHandoffService();
  });

  it('应解析 mention handoff', () => {
    expect(service.extractMentions('请 @Claude 接手，@Codex 复查')).toEqual(['claude', 'codex']);
  });

  it('应解析结构化 handoff block', () => {
    expect(
      service.extractStructuredHandoffs('[HANDOFF]\nto: claude-001\ntask: implement service\n[/HANDOFF]'),
    ).toEqual([{ to: 'claude-001', task: 'implement service' }]);
  });

  it('应将 mention 与结构化目标解析为 agent id', () => {
    const targets = service.resolveTargets(
      '先给 @Claude，再补一个 [HANDOFF]\nto: gemini-001\n[/HANDOFF]',
      [
        { id: 'claude-001', name: 'Claude', type: 'claude' },
        { id: 'gemini-001', name: 'Gemini', type: 'gemini' },
      ],
    );

    expect(targets).toEqual(['claude-001', 'gemini-001']);
  });
});
