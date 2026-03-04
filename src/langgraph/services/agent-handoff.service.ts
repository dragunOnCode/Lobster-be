import { Injectable } from '@nestjs/common';
import { ILLMAdapter } from '../../agents/interfaces';

export interface ParsedHandoff {
  to: string;
  task?: string;
  reason?: string;
}

@Injectable()
export class AgentHandoffService {
  extractMentions(content: string): string[] {
    const tokens = new Set<string>();
    const regex = /@([a-zA-Z0-9_-]+)/g;
    let match = regex.exec(content);
    while (match) {
      tokens.add(match[1].toLowerCase());
      match = regex.exec(content);
    }
    return Array.from(tokens);
  }

  extractStructuredHandoffs(content: string): ParsedHandoff[] {
    const blocks = content.match(/\[HANDOFF\][\s\S]*?\[\/HANDOFF\]/gi) ?? [];
    return blocks
      .map((block) => this.parseHandoffBlock(block))
      .filter((item): item is ParsedHandoff => item !== null);
  }

  resolveTargets(content: string, agents: Pick<ILLMAdapter, 'id' | 'name' | 'type'>[]): string[] {
    const mentions = this.extractMentions(content);
    const structured = this.extractStructuredHandoffs(content).map((item) => item.to.trim().toLowerCase());
    const tokens = new Set<string>([...mentions, ...structured]);
    if (tokens.size === 0) {
      return [];
    }

    const resolved = new Set<string>();
    for (const agent of agents) {
      const normalizedId = agent.id.toLowerCase();
      const normalizedName = agent.name.toLowerCase();
      const normalizedType = agent.type.toLowerCase();
      const prefix = normalizedId.split('-')[0];
      if (
        tokens.has(normalizedId) ||
        tokens.has(normalizedName) ||
        tokens.has(normalizedType) ||
        tokens.has(prefix)
      ) {
        resolved.add(agent.id);
      }
    }

    return Array.from(resolved);
  }

  private parseHandoffBlock(block: string): ParsedHandoff | null {
    const normalized = block.replace(/\[\/?HANDOFF\]/gi, '').trim();
    if (!normalized) {
      return null;
    }

    const result: ParsedHandoff = { to: '' };
    for (const rawLine of normalized.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || !line.includes(':')) {
        continue;
      }
      const [rawKey, ...rest] = line.split(':');
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(':').trim();
      if (!value) {
        continue;
      }
      if (key === 'to') {
        result.to = value;
      } else if (key === 'task') {
        result.task = value;
      } else if (key === 'reason') {
        result.reason = value;
      }
    }

    return result.to ? result : null;
  }
}
