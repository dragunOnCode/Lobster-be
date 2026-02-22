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
import { AgentContext } from '../agents/interfaces';
import { AgentService } from '../agents/services/agent.service';
import { DecisionEngineService } from '../agents/services/decision-engine.service';
import { ChatService } from '../chat/chat.service';
import { WsExceptionFilter } from '../common/filters/ws-exception.filter';
import { SharedMemoryService } from '../memory/services/shared-memory.service';
import { MessageRouter } from './message.router';
import { SessionManager } from './session.manager';

interface SendMessagePayload {
  content: string;
  sessionId: string;
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
  private readonly streamEmitIntervalMs = 50;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly messageRouter: MessageRouter,
    private readonly chatService: ChatService,
    private readonly agentService: AgentService,
    private readonly decisionEngine: DecisionEngineService,
    private readonly sharedMemoryService: SharedMemoryService,
  ) {}

  // 处理客户端连接，获取会话ID和用户ID，如果会话ID和用户ID为空，sessionManager负责添加客户端到会话，并发送会话历史记录
  async handleConnection(client: Socket): Promise<void> {
    const sessionId = this.getQueryValue(client, 'sessionId');
    const userId = this.getQueryValue(client, 'userId');

    if (!sessionId || !userId) {
      client.emit('connection:error', { message: 'sessionId 和 userId 为必填项' });
      client.disconnect();
      return;
    }

    await this.sessionManager.addClient(sessionId, client);
    void client.join(`session:${sessionId}`);

    const memberCount = this.sessionManager.getSessionMemberCount(sessionId);
    const activeSessionCount = this.sessionManager.getActiveSessionCount();

    const history = await this.chatService.getRecentMessages(sessionId, 20);
    client.emit('chat:history', history);
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
    if (!payload?.content?.trim() || !payload?.sessionId?.trim()) {
      client.emit('message:error', { message: 'content 和 sessionId 不能为空' });
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

    await this.handleAgentResponse(sessionId, {
      id: userMessage.id,
      sessionId,
      role: 'user',
      content: userMessage.content,
      userId,
    });

    return { ok: true };
  }

  private async handleAgentResponse(
    sessionId: string,
    message: { id: string; sessionId: string; role: 'user'; content: string; userId?: string },
  ): Promise<void> {
    try {
      const agents = await this.agentService.getAllAgents();
      const decisions = await this.decisionEngine.decideAll(message, agents, {
        sessionId,
        userId: message.userId,
      });

      await this.sharedMemoryService.setWorkspaceState(sessionId, {
        sessionId,
        updatedAt: new Date().toISOString(),
        lastUserMessage: message.content,
      });
      const workspaceState = await this.sharedMemoryService.getWorkspaceState(sessionId);
      const conversationHistory = await this.chatService.getRecentMessages(sessionId, 20);

      for (const decision of decisions) {
        await this.sharedMemoryService.setDecision(sessionId, decision.agent.id, {
          agentId: decision.agent.id,
          should: decision.should,
          reason: decision.reason,
          priority: decision.priority,
          timestamp: new Date().toISOString(),
        });

        if (!decision.should) {
          this.sessionManager.broadcastToSession(sessionId, 'agent:skip', {
            agentId: decision.agent.id,
            agentName: decision.agent.name,
            reason: decision.reason,
            sessionId,
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        this.sessionManager.broadcastToSession(sessionId, 'agent:thinking', {
          agentId: decision.agent.id,
          agentName: decision.agent.name,
          reason: decision.reason,
          priority: decision.priority,
          sessionId,
          timestamp: new Date().toISOString(),
        });

        try {
          const agentContext: AgentContext = {
            sessionId,
            userId: message.userId,
            conversationHistory,
            sharedMemory: {
              metadata: {
                workspaceState,
                lastDecision: await this.sharedMemoryService.getDecision(sessionId, decision.agent.id),
              },
            },
          };
          if (decision.agent.callType === 'http') {
            await this.handleStreamingAgentResponse(sessionId, message, decision.agent, agentContext);
          } else {
            await this.handleSingleShotAgentResponse(sessionId, message, decision.agent, agentContext);
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'agent execution failed';
          this.sessionManager.broadcastToSession(sessionId, 'agent:error', {
            sessionId,
            agentId: decision.agent.id,
            agentName: decision.agent.name,
            error: reason,
            timestamp: new Date().toISOString(),
          });
          this.logger.error(
            `agent execution failed, session=${sessionId}, agent=${decision.agent.id}, reason=${reason}`,
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent response failed';
      this.sessionManager.broadcastToSession(sessionId, 'agent:error', {
        sessionId,
        error: message,
        timestamp: new Date().toISOString(),
      });
      this.logger.error(`agent response failed, session=${sessionId}, reason=${message}`);
    }
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

  private async handleSingleShotAgentResponse(
    sessionId: string,
    message: { content: string; userId?: string },
    agent: {
      id: string;
      name: string;
      generate: (prompt: string, context: AgentContext) => Promise<{ content: string }>;
    },
    context: AgentContext,
  ): Promise<void> {
    const response = await agent.generate(message.content, context);
    const assistantMessage = await this.chatService.saveMessage({
      sessionId,
      role: 'assistant',
      agentId: agent.id,
      agentName: agent.name,
      content: response.content,
    });

    this.sessionManager.broadcastToSession(sessionId, 'message:received', assistantMessage);
    this.sessionManager.broadcastToSession(sessionId, 'agent:response', {
      agentId: agent.id,
      agentName: agent.name,
      messageId: assistantMessage.id,
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  private async handleStreamingAgentResponse(
    sessionId: string,
    message: { content: string; userId?: string },
    agent: {
      id: string;
      name: string;
      streamGenerate: (prompt: string, context: AgentContext) => AsyncGenerator<string>;
    },
    context: AgentContext,
  ): Promise<void> {
    const stream = agent.streamGenerate(message.content, context);

    let fullContent = '';
    let pendingDelta = '';
    let lastEmitAt = Date.now();

    for await (const delta of stream) {
      fullContent += delta;
      pendingDelta += delta;

      const now = Date.now();
      if (now - lastEmitAt >= this.streamEmitIntervalMs) {
        this.sessionManager.broadcastToSession(sessionId, 'agent:stream', {
          agentId: agent.id,
          agentName: agent.name,
          sessionId,
          delta: pendingDelta,
          timestamp: new Date().toISOString(),
        });
        pendingDelta = '';
        lastEmitAt = now;
      }
    }

    if (pendingDelta.length > 0) {
      this.sessionManager.broadcastToSession(sessionId, 'agent:stream', {
        agentId: agent.id,
        agentName: agent.name,
        sessionId,
        delta: pendingDelta,
        timestamp: new Date().toISOString(),
      });
    }

    this.sessionManager.broadcastToSession(sessionId, 'agent:stream:end', {
      agentId: agent.id,
      agentName: agent.name,
      sessionId,
      fullContent,
      timestamp: new Date().toISOString(),
    });

    const assistantMessage = await this.chatService.saveMessage({
      sessionId,
      role: 'assistant',
      agentId: agent.id,
      agentName: agent.name,
      content: fullContent,
    });

    this.sessionManager.broadcastToSession(sessionId, 'message:received', assistantMessage);
    this.sessionManager.broadcastToSession(sessionId, 'agent:response', {
      agentId: agent.id,
      agentName: agent.name,
      messageId: assistantMessage.id,
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }
}
