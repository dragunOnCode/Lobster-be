import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageEntity, SessionEntity } from '../database/entities';
import { MemoryMessage, ShortTermMemoryService } from '../memory/services/short-term-memory.service';
import { SharedMemoryService } from '../memory/services/shared-memory.service';
import { ChromaService } from '../vector/services/chroma.service';
import { WorkspaceService, SessionInfo, TranscriptEvent } from '../workspace/workspace.service';
import { ConversationSummaryService } from './conversation-summary.service';
import { RewindCompensationQueueService } from './rewind-compensation-queue.service';

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

interface SessionMessageBoundary {
  anchor: ChatMessage;
  kept: ChatMessage[];
  removed: ChatMessage[];
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
    @Optional() private readonly rewindCompensationQueue?: RewindCompensationQueueService,
  ) {
    // 调试日志：检查依赖注入状态
    this.logger.log(`Dependency injection status:`);
    this.logger.log(`  - messageRepo: ${this.messageRepo ? 'OK' : 'MISSING'}`);
    this.logger.log(`  - sessionRepo: ${this.sessionRepo ? 'OK' : 'MISSING'}`);
    this.logger.log(`  - workspaceService: ${this.workspaceService ? 'OK' : 'MISSING'}`);
    this.logger.log(`  - shortTermMemoryService: ${this.shortTermMemoryService ? 'OK' : 'MISSING'}`);
    this.logger.log(`  - chromaService: ${this.chromaService ? 'OK' : 'MISSING'}`);
    this.logger.log(`  - conversationSummaryService: ${this.conversationSummaryService ? 'OK' : 'MISSING'}`);
    this.logger.log(`  - sharedMemoryService: ${this.sharedMemoryService ? 'OK' : 'MISSING'}`);
    this.logger.log(`  - rewindCompensationQueue: ${this.rewindCompensationQueue ? 'OK' : 'MISSING'}`);
  }

  // 保存对话消息到数据库/JSONL
  async saveMessage(input: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage> {
    this.logger.log(`saveMessage: START sessionId=${input.sessionId}, role=${input.role}, contentPreview=${input.content.slice(0, 50)}...`);
    await this.workspaceService?.initializeSession(input.sessionId);

    const persistable = this.isUuid(input.sessionId) && !!this.messageRepo;
    this.logger.debug(`saveMessage: persistable=${persistable}, isUuid=${this.isUuid(input.sessionId)}, hasRepo=${!!this.messageRepo}`);
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
    this.logger.log(`saveMessage: transcript appended, calling tryAppendMemory for message=${message.id}`);
    // 保存到短期记忆
    await this.tryAppendMemory(message);
    this.logger.log(`saveMessage: tryAppendMemory completed, calling tryAddToVector for message=${message.id}`);
    // 保存向量
    await this.tryAddToVector(message);
    // 生成摘要
    await this.tryGenerateSummary(message.sessionId);
    this.logger.log(`saveMessage: COMPLETE message=${message.id} session=${message.sessionId}`);
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
    const normalized = await this.replaceSessionMessagesMainFact(sessionId, messages);
    await this.tryReplaceMemory(sessionId, normalized);
    await this.tryRebuildVectors(sessionId, normalized);
  }

  private async replaceSessionMessagesMainFact(sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
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
    return normalized;
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
        await this.withRetry(
          `delete-session-messages:${normalizedSessionId}`,
          () => this.messageRepo!.delete({ sessionId: normalizedSessionId }),
          { attempts: 3, baseDelayMs: 120 },
        );
      }
      await this.withRetry(
        `delete-session-row:${normalizedSessionId}`,
        () => this.sessionRepo!.delete({ id: normalizedSessionId }),
        { attempts: 3, baseDelayMs: 120 },
      );
    }

    await this.tryReplaceMemory(normalizedSessionId, []);
    await this.tryClearSharedMemory(normalizedSessionId);
    await this.tryRebuildVectors(normalizedSessionId, []);
    await this.workspaceService?.deleteSession(normalizedSessionId);
  }

  async rewindFromMessage(sessionId: string, messageId: string): Promise<{ removedCount: number }> {
    const normalizedSessionId = sessionId.trim();
    const normalizedMessageId = messageId.trim();
    if (!normalizedSessionId || !normalizedMessageId) {
      throw new Error('sessionId and messageId are required');
    }

    const fullSessionMessages = await this.getAllSessionMessages(normalizedSessionId);
    const boundary = this.splitByAnchorMessage(fullSessionMessages, normalizedSessionId, normalizedMessageId);
    if (!boundary) {
      throw new Error(`message not found in session: ${normalizedMessageId}`);
    }
    if (boundary.anchor.role !== 'user') {
      throw new Error('rewind is only allowed from user messages');
    }

    const transcriptSnapshot = await this.readTranscriptSafely(normalizedSessionId);
    const filteredTranscript = this.filterTranscriptEventsAfterAnchor(transcriptSnapshot, boundary);

    this.logger.log(
      `rewindFromMessage: session=${normalizedSessionId} anchor=${normalizedMessageId} kept=${boundary.kept.length} removed=${boundary.removed.length}`,
    );

    await this.withRetry(
      `rewind-main-fact:${normalizedSessionId}:${normalizedMessageId}`,
      () => this.replaceSessionMessagesMainFact(normalizedSessionId, boundary.kept),
      { attempts: 3, baseDelayMs: 150 },
    );

    try {
      await this.withRetry(
        `rewind-derived-sync:${normalizedSessionId}:${normalizedMessageId}`,
        () =>
          this.rebuildDerivedStateAfterRewind(
            normalizedSessionId,
            normalizedMessageId,
            'service',
            boundary.kept,
            filteredTranscript,
          ),
        { attempts: 3, baseDelayMs: 300 },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `rewindFromMessage: derived sync failed after main commit, enqueue compensation. session=${normalizedSessionId} anchor=${normalizedMessageId} reason=${reason}`,
      );
      await this.enqueueDerivedSyncCompensation(normalizedSessionId, normalizedMessageId, 'service');
    }

    return { removedCount: boundary.removed.length };
  }

  async rebuildDerivedStateAfterRewind(
    sessionId: string,
    anchorMessageId: string,
    attemptSource: 'service' | 'worker',
    preferredMessages?: ChatMessage[],
    preferredTranscript?: TranscriptEvent[],
  ): Promise<void> {
    const currentMessages = preferredMessages ?? (await this.getAllSessionMessages(sessionId));
    const transcript = preferredTranscript ?? (await this.buildTranscriptFromCurrentMessages(sessionId, currentMessages));

    await this.replaceMemoryStrict(sessionId, currentMessages);
    await this.rebuildVectorsStrict(sessionId, currentMessages);
    await this.clearSharedMemoryStrict(sessionId);
    if (this.workspaceService) {
      await this.workspaceService.replaceTranscript(sessionId, transcript);
    }

    this.logger.log(
      `rewind derived sync success session=${sessionId} anchor=${anchorMessageId} source=${attemptSource} messages=${currentMessages.length}`,
    );
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
    this.logger.log(`tryAppendMemory: START message=${message.id} session=${message.sessionId}`);
    if (!this.shortTermMemoryService) {
      this.logger.warn(`tryAppendMemory: shortTermMemoryService is UNDEFINED, skipping Redis cache`);
      return;
    }
    try {
      const memoryMessage = this.toMemoryMessage(message);
      this.logger.debug(`tryAppendMemory: calling shortTermMemoryService.append, message=${JSON.stringify(memoryMessage).slice(0, 200)}`);
      await this.shortTermMemoryService.append(message.sessionId, memoryMessage);
      this.logger.log(`tryAppendMemory: SUCCESS session=${message.sessionId} message=${message.id}`);
    } catch (error) {
      this.logger.error(`tryAppendMemory: FAILED session=${message.sessionId} error=${error}`);
    }
  }

  private async tryGetMemory(sessionId: string): Promise<ChatMessage[]> {
    if (!this.shortTermMemoryService) {
      this.logger.warn(`tryGetMemory: shortTermMemoryService is UNDEFINED`);
      return [];
    }
    try {
      this.logger.debug(`tryGetMemory: fetching session=${sessionId}`);
      const list = await this.shortTermMemoryService.get(sessionId);
      this.logger.log(`tryGetMemory: SUCCESS session=${sessionId} count=${list.length}`);
      return list.map((item) => this.fromMemoryMessage(item));
    } catch (error) {
      this.logger.error(`tryGetMemory: FAILED session=${sessionId} error=${error}`);
      return [];
    }
  }

  private async trySaveMemory(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (!this.shortTermMemoryService) {
      this.logger.warn(`trySaveMemory: shortTermMemoryService is UNDEFINED`);
      return;
    }
    try {
      this.logger.debug(`trySaveMemory: saving session=${sessionId} count=${messages.length}`);
      await this.shortTermMemoryService.save(
        sessionId,
        messages.map((item) => this.toMemoryMessage(item)),
      );
      this.logger.log(`trySaveMemory: SUCCESS session=${sessionId} count=${messages.length}`);
    } catch (error) {
      this.logger.error(`trySaveMemory: FAILED session=${sessionId} error=${error}`);
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

  private async getAllSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    if (this.isUuid(sessionId) && this.messageRepo) {
      const rows = await this.messageRepo.find({
        where: { sessionId },
        order: { createdAt: 'ASC' },
      });
      return rows
        .map((row) => ({
          id: row.id,
          sessionId: row.sessionId,
          userId: row.userId ?? undefined,
          agentId: row.agentId ?? undefined,
          agentName: row.agentName ?? undefined,
          role: row.role as ChatMessage['role'],
          content: row.content,
          mentionedAgents: row.mentionedAgents ?? [],
          createdAt: row.createdAt,
        }))
        .sort((left, right) => {
          const delta = left.createdAt.getTime() - right.createdAt.getTime();
          return delta !== 0 ? delta : left.id.localeCompare(right.id);
        });
    }

    const memory = this.messages.get(sessionId) ?? [];
    if (memory.length > 0) {
      return [...memory].sort((left, right) => {
        const delta = left.createdAt.getTime() - right.createdAt.getTime();
        return delta !== 0 ? delta : left.id.localeCompare(right.id);
      });
    }

    return this.tryGetTranscriptMessages(sessionId);
  }

  private splitByAnchorMessage(
    fullSessionMessages: ChatMessage[],
    sessionId: string,
    messageId: string,
  ): SessionMessageBoundary | null {
    const index = fullSessionMessages.findIndex((message) => message.sessionId === sessionId && message.id === messageId);
    if (index < 0) {
      return null;
    }

    return {
      anchor: fullSessionMessages[index],
      kept: fullSessionMessages.slice(0, index),
      removed: fullSessionMessages.slice(index),
    };
  }

  private async readTranscriptSafely(sessionId: string): Promise<TranscriptEvent[]> {
    if (!this.workspaceService) {
      return [];
    }
    try {
      return await this.workspaceService.readTranscript(sessionId);
    } catch (error) {
      this.logger.warn(
        `rewindFromMessage: failed to read transcript snapshot session=${sessionId}, continue with empty snapshot. reason=${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private filterTranscriptEventsAfterAnchor(
    events: TranscriptEvent[],
    boundary: SessionMessageBoundary,
  ): TranscriptEvent[] {
    if (events.length === 0 || boundary.removed.length === 0) {
      return events;
    }

    const removedIds = new Set(boundary.removed.map((message) => message.id));
    const anchorTs = boundary.anchor.createdAt.getTime();

    return events.filter((event) => {
      if (event.type !== 'message_saved') {
        return true;
      }
      const messageId = typeof event.messageId === 'string' ? event.messageId : '';
      if (messageId && removedIds.has(messageId)) {
        return false;
      }
      if (messageId) {
        return true;
      }
      const timestamp = typeof event.timestamp === 'string' ? event.timestamp : '';
      const ts = timestamp ? new Date(timestamp).getTime() : Number.NaN;
      if (!Number.isNaN(ts) && ts >= anchorTs) {
        return false;
      }
      return true;
    });
  }

  private async buildTranscriptFromCurrentMessages(
    sessionId: string,
    currentMessages: ChatMessage[],
  ): Promise<TranscriptEvent[]> {
    const events = await this.readTranscriptSafely(sessionId);
    if (events.length === 0) {
      return events;
    }

    const currentIds = new Set(currentMessages.map((message) => message.id));
    return events.filter((event) => {
      if (event.type !== 'message_saved') {
        return true;
      }
      const messageId = typeof event.messageId === 'string' ? event.messageId : '';
      if (!messageId) {
        return true;
      }
      return currentIds.has(messageId);
    });
  }

  private async replaceMemoryStrict(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (!this.shortTermMemoryService) {
      return;
    }
    if (messages.length === 0) {
      await this.shortTermMemoryService.clear(sessionId);
      return;
    }
    await this.shortTermMemoryService.save(
      sessionId,
      messages.map((item) => this.toMemoryMessage(item)),
    );
  }

  private async rebuildVectorsStrict(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (!this.chromaService) {
      return;
    }
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
  }

  private async clearSharedMemoryStrict(sessionId: string): Promise<void> {
    if (!this.sharedMemoryService) {
      return;
    }
    await this.sharedMemoryService.clearSession(sessionId);
  }

  private async enqueueDerivedSyncCompensation(
    sessionId: string,
    anchorMessageId: string,
    attemptSource: 'service' | 'worker',
  ): Promise<void> {
    if (!this.rewindCompensationQueue) {
      this.logger.error(
        `rewindFromMessage: compensation queue missing, cannot enqueue. session=${sessionId} anchor=${anchorMessageId}`,
      );
      return;
    }
    await this.rewindCompensationQueue.enqueueDerivedSync({
      sessionId,
      anchorMessageId,
      requestedAt: new Date().toISOString(),
      attemptSource,
    });
  }

  private async withRetry<T>(
    label: string,
    task: () => Promise<T>,
    options: { attempts: number; baseDelayMs: number },
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        if (attempt >= options.attempts) {
          break;
        }
        const delayMs = options.baseDelayMs * 2 ** (attempt - 1);
        this.logger.warn(
          `retry scheduled label=${label} attempt=${attempt}/${options.attempts} nextDelayMs=${delayMs} reason=${error instanceof Error ? error.message : String(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
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
