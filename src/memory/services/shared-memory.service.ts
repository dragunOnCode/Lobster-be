import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis.provider';

export interface WorkspaceState {
  sessionId: string;
  updatedAt: string;
  lastUserMessage?: string;
  mentionedAgents?: string[];
  [key: string]: unknown;
}

export interface AgentDecisionSnapshot {
  agentId: string;
  should: boolean;
  reason?: string;
  priority?: number;
  timestamp: string;
  [key: string]: unknown;
}

@Injectable()
export class SharedMemoryService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.ttlSeconds = Number(this.configService.getOrThrow<string>('SHARED_MEMORY_TTL'));
  }

  async setWorkspaceState(sessionId: string, state: WorkspaceState): Promise<void> {
    const key = this.getWorkspaceStateKey(sessionId);
    await this.redis.set(key, JSON.stringify(state), 'EX', this.ttlSeconds);
  }

  // 获取工作区状态：
  // WorkspaceState 包含：
  // - sessionId - 会话ID
  // - updatedAt - 更新时间
  // - lastUserMessage - 最后一条用户消息
  // - mentionedAgents - 被提及的 Agent 列表
  async getWorkspaceState(sessionId: string): Promise<WorkspaceState | null> {
    const key = this.getWorkspaceStateKey(sessionId);
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as WorkspaceState;
    } catch {
      return null;
    }
  }

  async setDecision(sessionId: string, agentId: string, decision: AgentDecisionSnapshot): Promise<void> {
    const key = this.getDecisionKey(sessionId, agentId);
    await this.redis.set(key, JSON.stringify(decision), 'EX', this.ttlSeconds);
  }

  // 获取Agent决策快照
  // AgentDecisionSnapshot 包含：
  // - agentId - Agent ID
  // - should - 是否应该响应
  // - reason - 决策原因
  // - priority - 优先级
  // - timestamp - 时间戳
  async getDecision(sessionId: string, agentId: string): Promise<AgentDecisionSnapshot | null> {
    const key = this.getDecisionKey(sessionId, agentId);
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as AgentDecisionSnapshot;
    } catch {
      return null;
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    const workspaceKey = this.getWorkspaceStateKey(sessionId);
    const decisionKeys = await this.collectKeysByPattern(`memory:shared:decision:${sessionId}:*`);
    const keys = [workspaceKey, ...decisionKeys];

    if (keys.length === 0) {
      return;
    }

    await this.redis.del(...keys);
  }

  private getWorkspaceStateKey(sessionId: string): string {
    return `memory:shared:workspace:${sessionId}`;
  }

  private getDecisionKey(sessionId: string, agentId: string): string {
    return `memory:shared:decision:${sessionId}:${agentId}`;
  }

  private async collectKeysByPattern(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }
}
