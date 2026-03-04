import { Injectable } from '@nestjs/common';
import { ChatGraphEvent } from '../../langgraph/interfaces/chat-graph-state.interface';

export interface SessionBroadcastEvent {
  event: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class LangGraphEventBridgeService {
  toSessionEvents(events: ChatGraphEvent[]): SessionBroadcastEvent[] {
    return events.flatMap((item) => this.toSessionEventsFromGraphEvent(item));
  }

  toSessionEventsFromGraphEvent(item: ChatGraphEvent): SessionBroadcastEvent[] {
    if (item.type === 'graph:agent_skip') {
      return [
        {
          event: 'agent:skip',
          payload: {
            ...item.payload,
            timestamp: item.createdAt,
          },
        },
      ];
    }

    if (item.type === 'graph:agent_thinking') {
      return [
        {
          event: 'agent:thinking',
          payload: {
            ...item.payload,
            timestamp: item.createdAt,
          },
        },
      ];
    }

    if (item.type === 'graph:agent_stream') {
      return [
        {
          event: 'agent:stream',
          payload: {
            ...item.payload,
            timestamp: item.createdAt,
          },
        },
      ];
    }

    if (item.type === 'graph:agent_stream_end') {
      return [
        {
          event: 'agent:stream:end',
          payload: {
            ...item.payload,
            timestamp: item.createdAt,
          },
        },
      ];
    }

    if (item.type !== 'graph:agent_response') {
      return [];
    }

    const sessionEvents: SessionBroadcastEvent[] = [];
    const message = item.payload.message as Record<string, unknown> | undefined;
    if (message) {
      sessionEvents.push({
        event: 'message:received',
        payload: {
          ...message,
          createdAt: typeof message.createdAt === 'string' ? new Date(message.createdAt) : message.createdAt,
        },
      });
    }

    sessionEvents.push({
      event: 'agent:response',
      payload: {
        sessionId: item.payload.sessionId,
        agentId: item.payload.agentId,
        agentName: item.payload.agentName,
        messageId: item.payload.messageId,
        timestamp: item.createdAt,
      },
    });

    return sessionEvents;
  }
}
