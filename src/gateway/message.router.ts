import { Injectable } from '@nestjs/common';

export interface MessageRouteResult {
  mentionedAgents: string[];
  normalizedContent: string;
}

@Injectable()
export class MessageRouter {
  route(content: string): MessageRouteResult {
    const mentionedAgents = this.parseMentions(content);
    return {
      mentionedAgents,
      normalizedContent: content.trim(),
    };
  }

  private parseMentions(content: string): string[] {
    const regex = /@([a-zA-Z0-9_-]+)/g;
    const set = new Set<string>();
    let match: RegExpExecArray | null = regex.exec(content);

    while (match) {
      set.add(match[1].toLowerCase());
      match = regex.exec(content);
    }

    return Array.from(set);
  }
}
