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

export interface AgentThreadBinding {
  sessionId: string;
  agentId: string;
  threadId: string;
  updatedAt: string;
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

  async setAgentThreadBinding(sessionId: string, agentId: string, threadId: string): Promise<void> {
    const key = this.getAgentThreadKey(sessionId, agentId);
    const payload: AgentThreadBinding = {
      sessionId,
      agentId,
      threadId,
      updatedAt: new Date().toISOString(),
    };
    await this.redis.set(key, JSON.stringify(payload), 'EX', this.ttlSeconds);
  }

  async getAgentThreadBinding(sessionId: string, agentId: string): Promise<AgentThreadBinding | null> {
    const key = this.getAgentThreadKey(sessionId, agentId);
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<AgentThreadBinding>;
      if (typeof parsed.threadId !== 'string' || parsed.threadId.length === 0) {
        return null;
      }
      return {
        sessionId,
        agentId,
        threadId: parsed.threadId,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private getWorkspaceStateKey(sessionId: string): string {
    return `memory:shared:workspace:${sessionId}`;
  }

  private getDecisionKey(sessionId: string, agentId: string): string {
    return `memory:shared:decision:${sessionId}:${agentId}`;
  }

  private getAgentThreadKey(sessionId: string, agentId: string): string {
    return `memory:shared:thread:${sessionId}:${agentId}`;
  }
}
