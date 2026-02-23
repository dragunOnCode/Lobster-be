import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageEntity, SessionEntity } from '../database/entities';
import { MemoryMessage, ShortTermMemoryService } from '../memory/services/short-term-memory.service';
import { ChromaService } from '../vector/services/chroma.service';
import { WorkspaceService } from '../workspace/workspace.service';

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
  ) {}

  async saveMessage(input: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage> {
    await this.workspaceService?.initializeSession(input.sessionId);
    await this.workspaceService?.appendTranscript(input.sessionId, {
      type: 'message_saved',
      role: input.role,
      userId: input.userId,
      agentId: input.agentId,
      contentPreview: input.content.slice(0, 200),
    });

    const persistable = this.isUuid(input.sessionId) && !!this.messageRepo;
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
      const message = {
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
      await this.tryAppendMemory(message);
      await this.tryAddToVector(message);
      return message;
    }

    const message: ChatMessage = {
      ...input,
      id: this.generateId(),
      createdAt: new Date(),
    };

    const sessionMessages = this.messages.get(input.sessionId) ?? [];
    sessionMessages.push(message);
    this.messages.set(input.sessionId, sessionMessages);

    await this.tryAppendMemory(message);
    await this.tryAddToVector(message);
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
    return sessionMessages.slice(-limit);
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
