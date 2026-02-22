import { Injectable } from '@nestjs/common';
import { AgentContext, ILLMAdapter, Message } from '../interfaces';

export interface AgentDecision {
  agent: ILLMAdapter;
  should: boolean;
  reason: string;
  priority: number;
}

@Injectable()
export class DecisionEngineService {
  async decideResponders(message: Message, agents: ILLMAdapter[], context: AgentContext): Promise<AgentDecision[]> {
    const all = await this.decideAll(message, agents, context);
    return all.filter((item) => item.should);
  }

  async decideAll(message: Message, agents: ILLMAdapter[], context: AgentContext): Promise<AgentDecision[]> {
    const mentioned = this.parseMentions(message.content);
    const decisions = await Promise.all(
      agents.map(async (agent) => this.decideOne(agent, message, context, mentioned)),
    );

    return decisions.sort((a, b) => {
      if (a.should !== b.should) {
        return a.should ? -1 : 1;
      }
      return b.priority - a.priority;
    });
  }

  private async decideOne(
    agent: ILLMAdapter,
    message: Message,
    context: AgentContext,
    mentioned: Set<string>,
  ): Promise<AgentDecision> {
    const normalizedName = agent.name.toLowerCase();
    const normalizedType = agent.type.toLowerCase();
    const normalizedId = agent.id.toLowerCase();
    const idPrefix = normalizedId.split('-')[0];

    const mentionedHit =
      mentioned.has(normalizedName) ||
      mentioned.has(normalizedType) ||
      mentioned.has(normalizedId) ||
      mentioned.has(idPrefix);

    if (mentioned.size > 0) {
      if (mentionedHit) {
        return {
          agent,
          should: true,
          reason: 'mentioned',
          priority: 10,
        };
      }
      return {
        agent,
        should: false,
        reason: 'not mentioned',
        priority: 0,
      };
    }

    try {
      const result = await this.withTimeout(agent.shouldRespond(message, context), 3000);
      return {
        agent,
        should: result.should,
        reason: result.reason ?? 'adapter decision',
        priority: this.mapPriority(result.priority),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'decision failed';
      return {
        agent,
        should: false,
        reason,
        priority: 0,
      };
    }
  }

  private parseMentions(content: string): Set<string> {
    const regex = /@([a-zA-Z0-9_-]+)/g;
    const set = new Set<string>();
    let match = regex.exec(content);
    while (match) {
      set.add(match[1].toLowerCase());
      match = regex.exec(content);
    }
    return set;
  }

  private mapPriority(priority?: 'high' | 'medium' | 'low'): number {
    if (priority === 'high') return 10;
    if (priority === 'medium') return 5;
    if (priority === 'low') return 1;
    return 0;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`decision timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
