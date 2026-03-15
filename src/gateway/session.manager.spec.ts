import { SessionManager } from './session.manager';

function createClient(id: string) {
  return {
    id,
    emit: jest.fn(),
  } as any;
}

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('应添加客户端并维护会话索引', async () => {
    const c1 = createClient('c1');
    await manager.addClient('s1', c1);

    expect(manager.hasClient('c1')).toBe(true);
    expect(manager.getSessionIdByClientId('c1')).toBe('s1');
    expect(manager.getSessionMemberCount('s1')).toBe(1);
    expect(manager.getActiveSessionCount()).toBe(1);
  });

  it('客户端切换会话时应从旧会话移除', async () => {
    const c1 = createClient('c1');
    await manager.addClient('s1', c1);
    await manager.addClient('s2', c1);

    expect(manager.getSessionMemberCount('s1')).toBe(0);
    expect(manager.getSessionMemberCount('s2')).toBe(1);
    expect(manager.getSessionIdByClientId('c1')).toBe('s2');
    expect(manager.getActiveSessionCount()).toBe(1);
  });

  it('removeClientById 应返回会话并清理索引', async () => {
    const c1 = createClient('c1');
    await manager.addClient('s1', c1);

    const sessionId = manager.removeClientById('c1');

    expect(sessionId).toBe('s1');
    expect(manager.hasClient('c1')).toBe(false);
    expect(manager.getSessionMemberCount('s1')).toBe(0);
  });

  it('应广播消息到指定会话成员', async () => {
    const c1 = createClient('c1');
    const c2 = createClient('c2');
    await manager.addClient('s1', c1);
    await manager.addClient('s1', c2);

    manager.broadcastToSession('s1', 'message:received', { ok: true });

    expect(c1.emit).toHaveBeenCalledWith('message:received', { ok: true });
    expect(c2.emit).toHaveBeenCalledWith('message:received', { ok: true });
  });

  it('应支持广播时排除指定客户端', async () => {
    const c1 = createClient('c1');
    const c2 = createClient('c2');
    await manager.addClient('s1', c1);
    await manager.addClient('s1', c2);

    manager.broadcastToSession('s1', 'typing', { userId: 'u1' }, { excludeClientId: 'c1' });

    expect(c1.emit).not.toHaveBeenCalled();
    expect(c2.emit).toHaveBeenCalledWith('typing', { userId: 'u1' });
  });
});
