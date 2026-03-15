import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageEntity, SessionEntity } from '../database/entities';
import { MemoryMessage, ShortTermMemoryService } from '../memory/services/short-term-memory.service';
import { SharedMemoryService } from '../memory/services/shared-memory.service';
import { ChromaService } from '../vector/services/chroma.service';
import { WorkspaceService, SessionInfo } from '../workspace/workspace.service';
import { ConversationSummaryService } from './conversation-summary.service';

export interface ChatMessage {
  id: string;
  sessionId: string;
  userId?: string;
  agentId?: string;
  agentName?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mentionedAgents?: string[];
  createdAt: Date;
}

interface TranscriptMessageEvent {
  type: 'message_saved';
  messageId?: unknown;
  sessionId?: unknown;
  userId?: unknown;
  agentId?: unknown;
  agentName?: unknown;
  role?: unknown;
  content?: unknown;
  contentPreview?: unknown;
  mentionedAgents?: unknown;
  timestamp?: unknown;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly messages = new Map<string, ChatMessage[]>();

  constructor(
    @Optional() @InjectRepository(MessageEntity) private readonly messageRepo?: Repository<MessageEntity>,
    @Optional() @InjectRepository(SessionEntity) private readonly sessionRepo?: Repository<SessionEntity>,
    @Optional() private readonly workspaceService?: WorkspaceService,
    @Optional() private readonly shortTermMemoryService?: ShortTermMemoryService,
    @Optional() private readonly chromaService?: ChromaService,
    @Optional() private readonly conversationSummaryService?: ConversationSummaryService,
    @Optional() private readonly sharedMemoryService?: SharedMemoryService,
  ) {}

  // 保存对话消息到数据库/JSONL
  async saveMessage(input: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage> {
    await this.workspaceService?.initializeSession(input.sessionId);

    const persistable = this.isUuid(input.sessionId) && !!this.messageRepo;
    let message: ChatMessage;
    if (persistable) {
      await this.ensureSessionExists(input.sessionId);

      const userId = input.userId && this.isUuid(input.userId) ? input.userId : null;
      const entity = this.messageRepo!.create({
        sessionId: input.sessionId,
        userId,
        agentId: input.agentId ?? null,
        agentName: input.agentName ?? null,
        role: input.role,
        content: input.content,
        mentionedAgents: input.mentionedAgents ?? [],
        metadata: !userId && input.userId ? { externalUserId: input.userId } : null,
      });

      const saved = await this.messageRepo!.save(entity);
      message = {
        id: saved.id,
        sessionId: saved.sessionId,
        userId: saved.userId ?? input.userId,
        agentId: saved.agentId ?? undefined,
        agentName: saved.agentName ?? undefined,
        role: saved.role as ChatMessage['role'],
        content: saved.content,
        mentionedAgents: saved.mentionedAgents ?? [],
        createdAt: saved.createdAt,
      };
    } else {
      message = {
        ...input,
        id: this.generateId(),
        createdAt: new Date(),
      };

      const sessionMessages = this.messages.get(input.sessionId) ?? [];
      sessionMessages.push(message);
      this.messages.set(input.sessionId, sessionMessages);
    }

    await this.workspaceService?.appendTranscript(input.sessionId, {
      type: 'message_saved',
      messageId: message.id,
      sessionId: message.sessionId,
      role: message.role,
      userId: message.userId,
      agentId: message.agentId,
      agentName: message.agentName,
      mentionedAgents: message.mentionedAgents ?? [],
      content: message.content,
      contentPreview: message.content.slice(0, 200),
      timestamp: message.createdAt.toISOString(),
    });
    // 保存到短期记忆
    await this.tryAppendMemory(message);
    // 保存向量
    await this.tryAddToVector(message);
    // 生成摘要
    await this.tryGenerateSummary(message.sessionId);
    return message;
  }

  async getRecentMessages(sessionId: string, limit = 20): Promise<ChatMessage[]> {
    const memoryMessages = await this.tryGetMemory(sessionId);
    if (memoryMessages.length > 0) {
      return memoryMessages.slice(-limit);
    }

    if (this.isUuid(sessionId) && this.messageRepo) {
      const rows = await this.messageRepo.find({
        where: { sessionId },
        order: { createdAt: 'DESC' },
        take: limit,
      });
      const mapped = rows.reverse().map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        userId: row.userId ?? undefined,
        agentId: row.agentId ?? undefined,
        agentName: row.agentName ?? undefined,
        role: row.role as ChatMessage['role'],
        content: row.content,
        mentionedAgents: row.mentionedAgents ?? [],
        createdAt: row.createdAt,
      }));

      await this.trySaveMemory(sessionId, mapped);
      return mapped;
    }

    const sessionMessages = this.messages.get(sessionId) ?? [];
    if (sessionMessages.length > 0) {
      return sessionMessages.slice(-limit);
    }

    const transcriptMessages = await this.tryGetTranscriptMessages(sessionId);
    if (transcriptMessages.length > 0) {
      await this.trySaveMemory(sessionId, transcriptMessages);
      return transcriptMessages.slice(-limit);
    }

    return [];
  }

  async getMessage(messageId: string): Promise<ChatMessage | null> {
    if (this.messageRepo) {
      const row = await this.messageRepo.findOne({ where: { id: messageId } });
      if (row) {
        return {
          id: row.id,
          sessionId: row.sessionId,
          userId: row.userId ?? undefined,
          agentId: row.agentId ?? undefined,
          agentName: row.agentName ?? undefined,
          role: row.role as ChatMessage['role'],
          content: row.content,
          mentionedAgents: row.mentionedAgents ?? [],
          createdAt: row.createdAt,
        };
      }
    }

    for (const msgs of this.messages.values()) {
      const found = msgs.find((m) => m.id === messageId);
      if (found) return found;
    }

    return null;
  }

  async listSessions(): Promise<SessionInfo[]> {
    if (this.workspaceService) {
      return this.workspaceService.listSessions();
    }
    return Array.from(this.messages.keys()).map((id) => ({ id, title: id }));
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    if (this.workspaceService) {
      await this.workspaceService.renameSession(sessionId, title);
    }
    if (this.isUuid(sessionId) && this.sessionRepo) {
      await this.sessionRepo.update({ id: sessionId }, { title });
    }
  }

  async replaceSessionMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const normalized = [...messages]
      .filter((message) => message.sessionId === sessionId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

    if (this.isUuid(sessionId) && this.messageRepo) {
      await this.ensureSessionExists(sessionId);
      await this.messageRepo.delete({ sessionId });

      if (normalized.length > 0) {
        await this.messageRepo.insert(
          normalized.map((message) => ({
            id: message.id,
            sessionId: message.sessionId,
            userId: message.userId && this.isUuid(message.userId) ? message.userId : null,
            agentId: message.agentId ?? null,
            agentName: message.agentName ?? null,
            role: message.role,
            content: message.content,
            mentionedAgents: message.mentionedAgents ?? [],
            metadata: !message.userId || this.isUuid(message.userId) ? null : { externalUserId: message.userId },
            createdAt: message.createdAt,
          })),
        );
      }
    } else {
      this.messages.set(sessionId, normalized);
    }

    await this.tryReplaceMemory(sessionId, normalized);
    await this.tryRebuildVectors(sessionId, normalized);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return;
    }

    this.messages.delete(normalizedSessionId);

    if (this.isUuid(normalizedSessionId) && this.sessionRepo) {
      // Keep a defensive message delete for partially inconsistent DB states.
      if (this.messageRepo) {
        await this.messageRepo.delete({ sessionId: normalizedSessionId });
      }
      await this.sessionRepo.delete({ id: normalizedSessionId });
    }

    await this.tryReplaceMemory(normalizedSessionId, []);
    await this.tryClearSharedMemory(normalizedSessionId);
    await this.tryRebuildVectors(normalizedSessionId, []);
    await this.workspaceService?.deleteSession(normalizedSessionId);
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private async ensureSessionExists(sessionId: string): Promise<void> {
    if (!this.sessionRepo) {
      return;
    }
    const found = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (found) {
      return;
    }

    await this.sessionRepo.save(
      this.sessionRepo.create({
        id: sessionId,
        title: `Session ${sessionId.slice(0, 8)}`,
        ownerId: null,
        participants: [],
        status: 'active',
        lastMessageAt: null,
      }),
    );
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async tryAppendMemory(message: ChatMessage): Promise<void> {
    if (!this.shortTermMemoryService) {
      return;
    }
    try {
      await this.shortTermMemoryService.append(message.sessionId, this.toMemoryMessage(message));
    } catch {
      // Redis 不可用时保持主流程可用，降级到 DB/内存
    }
  }

  private async tryGetMemory(sessionId: string): Promise<ChatMessage[]> {
    if (!this.shortTermMemoryService) {
      return [];
    }
    try {
      const list = await this.shortTermMemoryService.get(sessionId);
      return list.map((item) => this.fromMemoryMessage(item));
    } catch {
      return [];
    }
  }

  private async trySaveMemory(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (!this.shortTermMemoryService) {
      return;
    }
    try {
      await this.shortTermMemoryService.save(
        sessionId,
        messages.map((item) => this.toMemoryMessage(item)),
      );
    } catch {
      // ignore redis errors
    }
  }

  private async tryAddToVector(message: ChatMessage): Promise<void> {
    if (!this.chromaService) {
      return;
    }
    try {
      await this.chromaService.addDocument({
        id: message.id,
        content: message.content,
        metadata: {
          sessionId: message.sessionId,
          role: message.role,
          agentId: message.agentId ?? '',
          userId: message.userId ?? '',
          createdAt: message.createdAt.toISOString(),
        },
      });
      this.logger.debug(`Vector indexed message=${message.id} session=${message.sessionId}`);
    } catch {
      this.logger.warn(`Vector index failed for message=${message.id}, continue without semantic index`);
    }
  }

  private async tryReplaceMemory(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (!this.shortTermMemoryService) {
      return;
    }
    try {
      if (messages.length === 0) {
        await this.shortTermMemoryService.clear(sessionId);
        return;
      }

      await this.shortTermMemoryService.save(
        sessionId,
        messages.map((item) => this.toMemoryMessage(item)),
      );
    } catch {
      // ignore redis errors
    }
  }

  private async tryRebuildVectors(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (!this.chromaService) {
      return;
    }
    try {
      await this.chromaService.deleteBySessionId(sessionId);
      if (messages.length === 0) {
        return;
      }

      await this.chromaService.addDocuments(
        messages.map((message) => ({
          id: message.id,
          content: message.content,
          metadata: {
            sessionId: message.sessionId,
            role: message.role,
            agentId: message.agentId ?? '',
            userId: message.userId ?? '',
            createdAt: message.createdAt.toISOString(),
          },
        })),
      );
      this.logger.debug(`Vector rebuilt session=${sessionId} messages=${messages.length}`);
    } catch {
      this.logger.warn(`Vector rebuild failed for session=${sessionId}, continue without semantic index`);
    }
  }

  private async tryGenerateSummary(sessionId: string): Promise<void> {
    if (!this.conversationSummaryService) {
      return;
    }
    try {
      await this.conversationSummaryService.maybeGenerate(sessionId);
    } catch {
      this.logger.warn(`Auto summary failed session=${sessionId}, continue without summary`);
    }
  }

  private async tryClearSharedMemory(sessionId: string): Promise<void> {
    if (!this.sharedMemoryService) {
      return;
    }
    try {
      await this.sharedMemoryService.clearSession(sessionId);
    } catch {
      // ignore redis errors
    }
  }

  private async tryGetTranscriptMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.workspaceService) {
      return [];
    }
    try {
      const events = await this.workspaceService.readTranscript(sessionId);
      return events
        .map((event, index) => this.fromTranscriptMessageEvent(sessionId, event as TranscriptMessageEvent, index))
        .filter((message): message is ChatMessage => message !== null);
    } catch {
      return [];
    }
  }

  private fromTranscriptMessageEvent(
    sessionId: string,
    event: TranscriptMessageEvent,
    index: number,
  ): ChatMessage | null {
    if (event.type !== 'message_saved') {
      return null;
    }

    const role = event.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      return null;
    }

    const content =
      typeof event.content === 'string'
        ? event.content
        : typeof event.contentPreview === 'string'
          ? event.contentPreview
          : '';
    if (!content) {
      return null;
    }

    const timestamp = typeof event.timestamp === 'string' ? event.timestamp : new Date().toISOString();
    const createdAt = new Date(timestamp);

    return {
      id:
        typeof event.messageId === 'string' && event.messageId.length > 0
          ? event.messageId
          : `transcript_${sessionId}_${index}`,
      sessionId,
      userId: typeof event.userId === 'string' ? event.userId : undefined,
      agentId: typeof event.agentId === 'string' ? event.agentId : undefined,
      agentName: typeof event.agentName === 'string' ? event.agentName : undefined,
      role,
      content,
      mentionedAgents: Array.isArray(event.mentionedAgents) ? event.mentionedAgents.map((item) => String(item)) : [],
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    };
  }

  private toMemoryMessage(message: ChatMessage): MemoryMessage {
    return {
      id: message.id,
      sessionId: message.sessionId,
      userId: message.userId,
      agentId: message.agentId,
      agentName: message.agentName,
      role: message.role,
      content: message.content,
      mentionedAgents: message.mentionedAgents ?? [],
      createdAt: message.createdAt.toISOString(),
    };
  }

  private fromMemoryMessage(item: MemoryMessage): ChatMessage {
    return {
      id: item.id,
      sessionId: item.sessionId,
      userId: typeof item.userId === 'string' ? item.userId : undefined,
      agentId: typeof item.agentId === 'string' ? item.agentId : undefined,
      agentName: typeof item.agentName === 'string' ? item.agentName : undefined,
      role: item.role as ChatMessage['role'],
      content: item.content,
      mentionedAgents: Array.isArray(item.mentionedAgents) ? item.mentionedAgents.map((v) => String(v)) : [],
      createdAt: new Date(item.createdAt),
    };
  }
}
