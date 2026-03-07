import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UseFilters } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService } from '../chat/chat.service';
import { WsExceptionFilter } from '../common/filters/ws-exception.filter';
import { LangGraphOrchestratorService } from '../langgraph/services/langgraph-orchestrator.service';
import { MessageRouter } from './message.router';
import { SessionManager } from './session.manager';
import { LangGraphEventBridgeService } from './services/langgraph-event-bridge.service';

interface SendMessagePayload {
  content: string;
  sessionId: string;
}

interface RetryMessagePayload {
  messageId: string;
  sessionId: string;
}

interface RenameSessionPayload {
  sessionId: string;
  title: string;
}

@UseFilters(new WsExceptionFilter())
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly messageRouter: MessageRouter,
    private readonly chatService: ChatService,
    private readonly langGraphOrchestrator: LangGraphOrchestratorService,
    private readonly langGraphEventBridge: LangGraphEventBridgeService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const sessionId = this.getQueryValue(client, 'sessionId');
    const userId = this.getQueryValue(client, 'userId');

    if (!sessionId || !userId) {
      client.emit('connection:error', { message: 'sessionId 鍜?userId 涓哄繀濉」' });
      client.disconnect();
      return;
    }

    await this.sessionManager.addClient(sessionId, client);
    void client.join(`session:${sessionId}`);

    const memberCount = this.sessionManager.getSessionMemberCount(sessionId);
    const activeSessionCount = this.sessionManager.getActiveSessionCount();

    const history = await this.chatService.getRecentMessages(sessionId, 20);
    client.emit('chat:history', history);
    
    const sessions = await this.chatService.listSessions();
    client.emit('session:list', sessions);

    client.emit('session:presence', {
      sessionId,
      memberCount,
      activeSessionCount,
      timestamp: new Date().toISOString(),
    });

    this.sessionManager.broadcastToSession(
      sessionId,
      'user:joined',
      {
        userId,
        sessionId,
        memberCount,
        activeSessionCount,
        timestamp: new Date().toISOString(),
      },
      { excludeClientId: client.id },
    );

    this.logger.log(`client connected: ${client.id}, session=${sessionId}, user=${userId}`);
  }

  handleDisconnect(client: Socket): void {
    const sessionId = this.sessionManager.getSessionIdByClientId(client.id);
    if (!sessionId) {
      return;
    }

    this.sessionManager.removeClient(sessionId, client.id);

    const userId = this.getQueryValue(client, 'userId');
    const memberCount = this.sessionManager.getSessionMemberCount(sessionId);
    const activeSessionCount = this.sessionManager.getActiveSessionCount();

    this.sessionManager.broadcastToSession(sessionId, 'user:left', {
      userId,
      sessionId,
      memberCount,
      activeSessionCount,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`client disconnected: ${client.id}, session=${sessionId}`);
  }

  @SubscribeMessage('message:send')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessagePayload,
  ): Promise<{ ok: boolean }> {
    this.logger.log(`payload: ${JSON.stringify(payload)}`);
    if (!payload?.content?.trim() || !payload?.sessionId?.trim()) {
      client.emit('message:error', { message: 'content 鍜?sessionId 涓嶈兘涓虹┖' });
      return { ok: false };
    }

    const sessionId = payload.sessionId.trim();
    const userId = this.getQueryValue(client, 'userId') ?? 'anonymous';
    const routeResult = this.messageRouter.route(payload.content);

    const userMessage = await this.chatService.saveMessage({
      sessionId,
      userId,
      role: 'user',
      content: routeResult.normalizedContent,
      mentionedAgents: routeResult.mentionedAgents,
    });

    this.sessionManager.broadcastToSession(sessionId, 'message:received', userMessage);

    if (routeResult.mentionedAgents.length > 0) {
      this.sessionManager.broadcastToSession(sessionId, 'message:mention', {
        messageId: userMessage.id,
        mentionedAgents: routeResult.mentionedAgents,
        sessionId,
      });
    }

    try {
      for await (const chunk of this.langGraphOrchestrator.streamTurnFromSavedMessage({
        id: userMessage.id,
        sessionId,
        role: 'user',
        content: userMessage.content,
        userId,
        createdAt: userMessage.createdAt,
      })) {
        if (chunk.mode !== 'custom') {
          continue;
        }

        const sessionEvents = this.langGraphEventBridge.toSessionEventsFromGraphEvent(chunk.payload);
        for (const event of sessionEvents) {
          this.sessionManager.broadcastToSession(sessionId, event.event, event.payload);
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'LangGraph agent response failed';
      this.sessionManager.broadcastToSession(sessionId, 'agent:error', {
        sessionId,
        messageId: userMessage.id,
        error: reason,
        timestamp: new Date().toISOString(),
      });
      this.logger.error(`langgraph response failed, session=${sessionId}, reason=${reason}`);
    }

    return { ok: true };
  }

  @SubscribeMessage('message:retry')
  async handleRetry(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RetryMessagePayload,
  ): Promise<{ ok: boolean }> {
    if (!payload?.messageId?.trim() || !payload?.sessionId?.trim()) {
      client.emit('message:error', { message: 'messageId 和 sessionId 不能为空' });
      return { ok: false };
    }

    const sessionId = payload.sessionId.trim();
    const userId = this.getQueryValue(client, 'userId') ?? 'anonymous';

    const existingMessage = await this.chatService.getMessage(payload.messageId.trim());
    if (!existingMessage || existingMessage.role !== 'user') {
      client.emit('message:error', { message: '找不到对应的用户消息' });
      return { ok: false };
    }

    this.logger.log(`retry message=${existingMessage.id}, session=${sessionId}`);

    try {
      for await (const chunk of this.langGraphOrchestrator.streamTurnFromSavedMessage({
        id: existingMessage.id,
        sessionId,
        role: 'user',
        content: existingMessage.content,
        userId,
        createdAt: existingMessage.createdAt,
      })) {
        if (chunk.mode !== 'custom') {
          continue;
        }

        const sessionEvents = this.langGraphEventBridge.toSessionEventsFromGraphEvent(chunk.payload);
        for (const event of sessionEvents) {
          this.sessionManager.broadcastToSession(sessionId, event.event, event.payload);
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'LangGraph agent response failed';
      this.sessionManager.broadcastToSession(sessionId, 'agent:error', {
        sessionId,
        messageId: existingMessage.id,
        error: reason,
        timestamp: new Date().toISOString(),
      });
      this.logger.error(`langgraph retry failed, session=${sessionId}, reason=${reason}`);
    }

    return { ok: true };
  }

  @SubscribeMessage('session:rename')
  async handleRenameSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RenameSessionPayload,
  ): Promise<{ ok: boolean }> {
    if (!payload?.sessionId?.trim() || !payload?.title?.trim()) {
      client.emit('message:error', { message: 'sessionId 鍜?title 涓嶈兘涓虹┖' });
      return { ok: false };
    }
    
    await this.chatService.renameSession(payload.sessionId.trim(), payload.title.trim());
    
    const sessions = await this.chatService.listSessions();
    this.sessionManager.broadcastToAll('session:list', sessions);
    return { ok: true };
  }

  private getQueryValue(client: Socket, key: string): string | undefined {
    const raw = client.handshake.query[key];
    if (typeof raw === 'string') {
      return raw;
    }
    if (Array.isArray(raw)) {
      return raw[0];
    }
    return undefined;
  }
}
