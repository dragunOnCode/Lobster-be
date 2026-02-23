# Sprint 3 详细任务看板

> **Sprint周期**：第5-6周  
> **Sprint目标**：优化增强，生产可用  
> **版本**：v0.3.0  
> **日期**：2026-02-23  
> **前置条件**：Sprint 2（v0.2.0）已完成

---

## Sprint 2 回顾

### 已完成功能

| 模块 | 状态 | 说明 |
|------|------|------|
| 3个Agent全部可用 | ✅ 完成 | Claude (HTTP) / Codex (CLI) / Gemini (CLI) |
| Agent决策引擎 | ✅ 完成 | DecisionEngine并行决策，优先级排序 |
| @提及功能 | ✅ 完成 | MessageRouter正则解析，精确匹配 |
| Claude流式响应 | ✅ 完成 | SSE stream → WebSocket增量推送 |
| Redis记忆层 | ✅ 完成 | ShortTermMemory (5min TTL) / SharedMemory (1h TTL) |
| Config热重载 | ✅ 完成 | Chokidar监听agents.config.json |
| CLI Runner | ✅ 完成 | 统一CLI调用，超时/重试/错误处理 |
| 全局异常过滤器 | ✅ 完成 | HttpExceptionFilter / WsExceptionFilter |

### Sprint 2 遗留问题

| 问题 | 优先级 | Sprint 3 计划 |
|------|--------|--------------|
| Redis Pub/Sub | P2 | 本Sprint实现 |
| 记忆摘要 | P1 | 本Sprint实现（核心） |
| 向量检索 | P1 | 本Sprint实现（核心） |
| 性能监控 | P2 | 本Sprint实现 |
| 压力测试 | P2 | 本Sprint实现 |

---

## Sprint 目标

### 核心目标

```
✅ BullMQ 任务队列与定时任务（Cron）
✅ ChromaDB 向量检索（语义搜索）
✅ 记忆自动摘要（GPT-4o-mini）
✅ LangGraph 结构化工作流（可选）
✅ 性能优化与压力测试
✅ 监控告警系统（Prometheus + Grafana）
```

### Demo场景

```
场景1: 自动记忆摘要
  → 用户与Agent持续对话1小时
  → 系统自动触发摘要（每小时Cron）
  → GPT-4o-mini生成摘要并保存
  → 下次对话时，Agent优先加载摘要而非全部历史

场景2: 语义检索
  用户: "之前讨论的认证方案是什么?"
  → 系统使用ChromaDB语义检索历史消息
  → 找到相关对话片段（即使不含"认证"关键词）
  → Agent基于检索结果回答

场景3: 定时任务
  → 每5分钟: Agent健康检查
  → 每小时: 记忆摘要
  → 每天凌晨2点: 清理过期会话
  → 每周: 数据库备份

场景4: 结构化工作流（可选）
  用户: "执行完整的需求分析流程"
  → 系统切换到LangGraph模式
  → 按预定义工作流依次调用Agent
  → 收集需求 → 分析 → 设计 → 评审 → 输出文档
```

---

## Week 5 (Day 1-5): Cron任务与向量检索

### Day 1-2: BullMQ 任务队列

#### 任务 13.1: BullMQ 基础设施

**目标**：集成BullMQ作为任务队列和定时任务调度器。

**文件**：
- `src/tasks/tasks.module.ts` [NEW]
- `src/tasks/processors/scheduled-tasks.processor.ts` [NEW]
- `src/tasks/queues/background-tasks.queue.ts` [NEW]

**子任务**：

```
□ 安装依赖
  npm install @nestjs/bull bull bullmq ioredis
  npm install -D @types/bull
  预计: 15分钟

□ 创建 TasksModule
  - 配置 BullModule
  - 连接到 Redis
  - 注册队列（background-tasks, cron-tasks）
  预计: 1.5小时

□ 创建 ScheduledTasksProcessor
  - @Processor('cron-tasks')
  - OnModuleInit 注册定时任务
  预计: 2小时

□ 测试
  - 验证队列连接
  - 测试任务添加/执行
  预计: 1小时
```

**实现要点**：

```typescript
// src/tasks/tasks.module.ts
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST'),
          port: configService.get('REDIS_PORT'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: 'background-tasks' },
      { name: 'cron-tasks' },
      { name: 'memory-tasks' },
    ),
  ],
  providers: [
    ScheduledTasksProcessor,
    MemoryTasksProcessor,
  ],
  exports: [BullModule],
})
export class TasksModule {}
```

**验收标准**：
- ✅ BullMQ连接成功
- ✅ 可以添加任务到队列
- ✅ 任务可以被处理器执行
- ✅ Redis中可见队列数据

---

#### 任务 13.2: 定时任务实现

**文件**：`src/tasks/processors/scheduled-tasks.processor.ts`

**子任务**：

```
□ Agent健康检查（每5分钟）
  - 遍历所有Agent调用healthCheck()
  - 更新Agent状态到Redis
  - 失败时记录日志并告警
  预计: 2小时

□ 会话清理（每天凌晨2点）
  - 查询30天未活跃会话
  - 归档到MinIO
  - 从数据库删除
  预计: 2.5小时

□ 数据库备份（每天凌晨3点）
  - 调用pg_dump
  - 上传到MinIO
  - 保留最近7天备份
  预计: 2小时

□ 错误处理与重试
  - 失败任务自动重试（最多3次）
  - 记录到transcript
  预计: 1.5小时
```

**实现示例**：

```typescript
// src/tasks/processors/scheduled-tasks.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';

@Processor('cron-tasks')
export class ScheduledTasksProcessor {
  constructor(
    private readonly agentService: AgentService,
    private readonly sessionService: SessionService,
    private readonly workspaceService: WorkspaceService,
    private readonly alertService: AlertService,
  ) {}

  /**
   * 每5分钟检查Agent健康状态
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduleHealthCheck() {
    await this.healthCheckQueue.add('check-agents', {});
  }

  @Process('check-agents')
  async handleHealthCheck(job: Job) {
    const startTime = Date.now();
    const agents = await this.agentService.getAllAgents();
    
    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        const isHealthy = await agent.healthCheck();
        
        await this.agentService.updateStatus(agent.id, {
          status: isHealthy ? 'online' : 'offline',
          lastHealthCheck: new Date(),
        });

        if (!isHealthy) {
          await this.alertService.sendAlert({
            type: 'agent_unhealthy',
            agent: agent.name,
            timestamp: new Date(),
          });
        }

        return { agent: agent.name, healthy: isHealthy };
      }),
    );

    const elapsed = Date.now() - startTime;
    console.log(`✅ Agent健康检查完成 (${elapsed}ms)`, results);
  }

  /**
   * 每天凌晨2点清理过期会话
   */
  @Cron('0 2 * * *')
  async scheduleSessionCleanup() {
    await this.cleanupQueue.add('cleanup-sessions', {});
  }

  @Process('cleanup-sessions')
  async handleSessionCleanup(job: Job) {
    const expiredDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30天前
    
    const expiredSessions = await this.sessionService.findExpired(expiredDate);
    
    for (const session of expiredSessions) {
      try {
        // 1. 归档工作空间到MinIO
        const archivePath = await this.workspaceService.archiveSession(session.id);
        
        // 2. 标记为已归档
        await this.sessionService.update(session.id, {
          status: 'archived',
          archivedAt: new Date(),
          archivePath,
        });
        
        // 3. 从Redis清理缓存
        await this.redisService.del(`session:${session.id}`);
        await this.redisService.del(`memory:short:${session.id}`);
        
        console.log(`📦 会话已归档: ${session.id}`);
      } catch (error) {
        console.error(`❌ 会话归档失败: ${session.id}`, error);
      }
    }
    
    console.log(`✅ 清理完成: ${expiredSessions.length} 个会话`);
  }

  /**
   * 每天凌晨3点备份数据库
   */
  @Cron('0 3 * * *')
  async scheduleDatabaseBackup() {
    await this.backupQueue.add('backup-database', {});
  }

  @Process('backup-database')
  async handleDatabaseBackup(job: Job) {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupFile = `backup-${timestamp}.sql`;
    
    try {
      // 1. 执行pg_dump
      const { stdout } = await execAsync(
        `pg_dump -h ${this.config.get('DB_HOST')} -U ${this.config.get('DB_USER')} -d ${this.config.get('DB_NAME')} > /tmp/${backupFile}`,
      );
      
      // 2. 上传到MinIO
      await this.minioClient.fPutObject(
        'backups',
        backupFile,
        `/tmp/${backupFile}`,
        { 'Content-Type': 'application/sql' },
      );
      
      // 3. 清理本地临时文件
      await fs.unlink(`/tmp/${backupFile}`);
      
      // 4. 删除7天前的备份
      await this.cleanOldBackups();
      
      console.log(`✅ 数据库备份完成: ${backupFile}`);
    } catch (error) {
      console.error(`❌ 数据库备份失败`, error);
      await this.alertService.sendAlert({
        type: 'backup_failed',
        error: error.message,
        timestamp: new Date(),
      });
    }
  }

  private async cleanOldBackups() {
    const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const objectsList = await this.minioClient.listObjects('backups', '', true);
    
    for await (const obj of objectsList) {
      if (new Date(obj.lastModified) < cutoffDate) {
        await this.minioClient.removeObject('backups', obj.name);
        console.log(`🗑️ 删除旧备份: ${obj.name}`);
      }
    }
  }
}
```

**验收标准**：
- ✅ 健康检查每5分钟自动执行
- ✅ 会话清理每天凌晨2点执行
- ✅ 数据库备份成功上传到MinIO
- ✅ 失败任务有重试机制
- ✅ 可在BullBoard UI查看任务状态

---

### Day 3-4: ChromaDB 向量检索

#### 任务 14.1: ChromaDB 集成

**目标**：集成ChromaDB实现语义检索。

**文件**：
- `src/vector/vector.module.ts` [NEW]
- `src/vector/services/chroma.service.ts` [NEW]
- `src/vector/services/embedding.service.ts` [NEW]

**子任务**：

```
□ 安装依赖
  npm install chromadb openai
  npm install -D @types/chromadb
  预计: 15分钟

□ 创建 VectorModule
  - 配置 ChromaDB 连接
  - 初始化集合（messages, summaries）
  预计: 1.5小时

□ 创建 ChromaService
  - addDocument() - 向量化并存储
  - search() - 语义搜索
  - deleteBySessionId() - 清理
  预计: 3小时

□ 创建 EmbeddingService
  - 使用 OpenAI text-embedding-3-small
  - 批量嵌入优化
  预计: 2小时

□ 测试
  - 存储测试消息
  - 语义搜索测试
  - 相似度阈值调优
  预计: 2小时
```

**实现示例**：

```typescript
// src/vector/services/chroma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ChromaClient, Collection } from 'chromadb';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ChromaService implements OnModuleInit {
  private client: ChromaClient;
  private messagesCollection: Collection;
  private summariesCollection: Collection;

  constructor(
    private readonly configService: ConfigService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async onModuleInit() {
    const chromaUrl = this.configService.get('CHROMA_URL', 'http://localhost:8000');
    this.client = new ChromaClient({ path: chromaUrl });

    // 创建或获取集合
    this.messagesCollection = await this.client.getOrCreateCollection({
      name: 'messages',
      metadata: { 'hnsw:space': 'cosine' },
    });

    this.summariesCollection = await this.client.getOrCreateCollection({
      name: 'summaries',
      metadata: { 'hnsw:space': 'cosine' },
    });

    console.log('✅ ChromaDB连接成功');
  }

  /**
   * 添加消息到向量库
   */
  async addMessage(message: Message): Promise<void> {
    // 1. 生成向量
    const embedding = await this.embeddingService.embed(message.content);

    // 2. 存储
    await this.messagesCollection.add({
      ids: [message.id],
      embeddings: [embedding],
      documents: [message.content],
      metadatas: [{
        sessionId: message.sessionId,
        role: message.role,
        agentId: message.agentId,
        createdAt: message.createdAt.toISOString(),
      }],
    });

    console.log(`📊 消息已向量化: ${message.id}`);
  }

  /**
   * 批量添加消息
   */
  async addMessagesBatch(messages: Message[]): Promise<void> {
    if (messages.length === 0) return;

    // 1. 批量生成向量
    const embeddings = await this.embeddingService.embedBatch(
      messages.map(m => m.content),
    );

    // 2. 批量存储
    await this.messagesCollection.add({
      ids: messages.map(m => m.id),
      embeddings,
      documents: messages.map(m => m.content),
      metadatas: messages.map(m => ({
        sessionId: m.sessionId,
        role: m.role,
        agentId: m.agentId,
        createdAt: m.createdAt.toISOString(),
      })),
    });

    console.log(`📊 批量向量化完成: ${messages.length} 条消息`);
  }

  /**
   * 语义搜索
   */
  async searchMessages(params: {
    query: string;
    sessionId?: string;
    limit?: number;
    minSimilarity?: number;
  }): Promise<SearchResult[]> {
    const { query, sessionId, limit = 10, minSimilarity = 0.7 } = params;

    // 1. 生成查询向量
    const queryEmbedding = await this.embeddingService.embed(query);

    // 2. 搜索
    const results = await this.messagesCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      where: sessionId ? { sessionId } : undefined,
    });

    // 3. 过滤低相似度结果
    return results.ids[0]
      .map((id, index) => ({
        id,
        content: results.documents[0][index],
        metadata: results.metadatas[0][index],
        similarity: 1 - results.distances[0][index], // Cosine similarity
      }))
      .filter(r => r.similarity >= minSimilarity);
  }

  /**
   * 添加摘要到向量库
   */
  async addSummary(sessionId: string, summary: string): Promise<void> {
    const embedding = await this.embeddingService.embed(summary);

    await this.summariesCollection.add({
      ids: [`summary_${sessionId}_${Date.now()}`],
      embeddings: [embedding],
      documents: [summary],
      metadatas: [{
        sessionId,
        createdAt: new Date().toISOString(),
      }],
    });

    console.log(`📊 摘要已向量化: ${sessionId}`);
  }

  /**
   * 搜索相关摘要
   */
  async searchSummaries(query: string, sessionId?: string): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingService.embed(query);

    const results = await this.summariesCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: 5,
      where: sessionId ? { sessionId } : undefined,
    });

    return results.ids[0].map((id, index) => ({
      id,
      content: results.documents[0][index],
      metadata: results.metadatas[0][index],
      similarity: 1 - results.distances[0][index],
    }));
  }

  /**
   * 删除会话所有向量
   */
  async deleteBySessionId(sessionId: string): Promise<void> {
    await this.messagesCollection.delete({
      where: { sessionId },
    });

    await this.summariesCollection.delete({
      where: { sessionId },
    });

    console.log(`🗑️ 已删除会话向量: ${sessionId}`);
  }
}

// src/vector/services/embedding.service.ts
import { Injectable } from '@nestjs/common';
import { Configuration, OpenAIApi } from 'openai';

@Injectable()
export class EmbeddingService {
  private openai: OpenAIApi;

  constructor(private readonly configService: ConfigService) {
    const configuration = new Configuration({
      apiKey: this.configService.get('OPENAI_API_KEY'),
    });
    this.openai = new OpenAIApi(configuration);
  }

  /**
   * 单条文本向量化
   */
  async embed(text: string): Promise<number[]> {
    const response = await this.openai.createEmbedding({
      model: 'text-embedding-3-small',
      input: text,
    });

    return response.data.data[0].embedding;
  }

  /**
   * 批量文本向量化
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.openai.createEmbedding({
      model: 'text-embedding-3-small',
      input: texts,
    });

    return response.data.data.map(d => d.embedding);
  }
}

interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, any>;
  similarity: number;
}
```

**验收标准**：
- ✅ ChromaDB连接成功
- ✅ 可以向量化并存储消息
- ✅ 语义搜索返回相关结果
- ✅ 相似度计算准确

---

#### 任务 14.2: 语义检索集成到 Agent

**文件**：
- `src/agents/services/context-builder.service.ts` [NEW]
- `src/agents/adapters/claude.adapter.ts` [MODIFIED]

**子任务**：

```
□ 创建 ContextBuilderService
  - buildContext() - 构建Agent上下文
  - 优先使用语义检索相关消息
  - 回退到短期记忆
  预计: 3小时

□ 集成到 Claude Adapter
  - generate() 前调用 contextBuilder
  - 注入检索结果到 prompt
  预计: 2小时

□ 测试
  - 对话多轮后询问早期话题
  - 验证Agent可以检索到相关上下文
  预计: 2小时
```

**实现示例**：

```typescript
// src/agents/services/context-builder.service.ts
@Injectable()
export class ContextBuilderService {
  constructor(
    private readonly chromaService: ChromaService,
    private readonly shortTermMemory: ShortTermMemoryService,
    private readonly sharedMemory: SharedMemoryService,
  ) {}

  async buildContext(sessionId: string, currentMessage: string): Promise<AgentContext> {
    // 1. 语义检索相关历史消息（优先）
    const semanticResults = await this.chromaService.searchMessages({
      query: currentMessage,
      sessionId,
      limit: 5,
      minSimilarity: 0.75,
    });

    // 2. 短期记忆（最近20条）
    const recentMessages = await this.shortTermMemory.get(sessionId);

    // 3. 共享工作空间状态
    const workspaceState = await this.sharedMemory.getWorkspaceState(sessionId);

    // 4. 摘要（如果存在）
    const summaries = await this.chromaService.searchSummaries(currentMessage, sessionId);

    return {
      sessionId,
      conversationHistory: recentMessages,
      semanticContext: semanticResults.map(r => ({
        content: r.content,
        similarity: r.similarity,
        timestamp: r.metadata.createdAt,
      })),
      summaries: summaries.map(s => s.content),
      sharedMemory: workspaceState,
    };
  }
}
```

**验收标准**：
- ✅ Agent可以检索到相关历史对话
- ✅ 即使不在短期记忆中也能找到
- ✅ 语义相似度高的优先使用

---

## Week 6 (Day 6-10): 记忆摘要与工作流

### Day 6-7: 记忆自动摘要

#### 任务 15.1: 记忆摘要服务

**目标**：使用GPT-4o-mini自动生成对话摘要。

**文件**：
- `src/memory/services/summarization.service.ts` [NEW]
- `src/tasks/processors/memory-tasks.processor.ts` [NEW]

**子任务**：

```
□ 创建 SummarizationService
  - shouldSummarize() - 判断是否需要摘要
  - generateSummary() - 生成摘要
  - saveSummary() - 保存摘要
  预计: 3小时

□ 集成 GPT-4o-mini
  - 使用 OpenAI API
  - 设计摘要提示词
  预计: 2小时

□ 创建定时任务
  - 每小时检查活跃会话
  - 超过50条消息触发摘要
  预计: 2小时

□ 测试
  - 模拟长对话
  - 验证摘要质量
  预计: 2小时
```

**实现示例**：

```typescript
// src/memory/services/summarization.service.ts
@Injectable()
export class SummarizationService {
  private readonly openai: OpenAIApi;

  constructor(
    private readonly messageRepo: MessageRepository,
    private readonly chromaService: ChromaService,
    private readonly configService: ConfigService,
  ) {
    const configuration = new Configuration({
      apiKey: this.configService.get('OPENAI_API_KEY'),
    });
    this.openai = new OpenAIApi(configuration);
  }

  /**
   * 判断是否需要生成摘要
   */
  async shouldSummarize(sessionId: string): Promise<boolean> {
    // 1. 查询最后一次摘要时间
    const lastSummary = await this.getLastSummary(sessionId);
    const cutoffTime = lastSummary?.createdAt || new Date(0);

    // 2. 统计之后的消息数
    const count = await this.messageRepo.count({
      where: {
        sessionId,
        createdAt: MoreThan(cutoffTime),
      },
    });

    // 超过50条消息触发摘要
    return count >= 50;
  }

  /**
   * 生成摘要
   */
  async generateSummary(sessionId: string): Promise<string> {
    const startTime = Date.now();

    // 1. 获取最后一次摘要后的所有消息
    const lastSummary = await this.getLastSummary(sessionId);
    const cutoffTime = lastSummary?.createdAt || new Date(0);

    const messages = await this.messageRepo.find({
      where: {
        sessionId,
        createdAt: MoreThan(cutoffTime),
      },
      order: { createdAt: 'ASC' },
    });

    // 2. 构建对话文本
    const conversationText = messages
      .map(m => `${m.role === 'user' ? '用户' : m.agentName || 'Agent'}: ${m.content}`)
      .join('\n\n');

    // 3. 调用 GPT-4o-mini 生成摘要
    const response = await this.openai.createChatCompletion({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: this.getSummarizationPrompt(),
        },
        {
          role: 'user',
          content: `以下是需要总结的对话内容（共${messages.length}条消息）：\n\n${conversationText}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const summary = response.data.choices[0].message.content;
    const elapsed = Date.now() - startTime;

    console.log(`📝 摘要生成完成 (${elapsed}ms, ${messages.length} 条消息)`);

    return summary;
  }

  /**
   * 保存摘要
   */
  async saveSummary(sessionId: string, summary: string): Promise<void> {
    // 1. 保存到数据库
    await this.summaryRepo.save({
      sessionId,
      content: summary,
      messageCount: await this.getMessageCountSinceLastSummary(sessionId),
      createdAt: new Date(),
    });

    // 2. 向量化摘要
    await this.chromaService.addSummary(sessionId, summary);

    // 3. 记录到 transcript
    await this.workspaceService.appendTranscript(sessionId, {
      type: 'summary_generated',
      summary,
      timestamp: new Date().toISOString(),
    });

    console.log(`💾 摘要已保存: ${sessionId}`);
  }

  /**
   * 摘要提示词
   */
  private getSummarizationPrompt(): string {
    return `你是一个专业的对话摘要助手。请根据以下对话内容生成简洁、结构化的摘要。

要求：
1. 提取关键信息：主要讨论的技术点、做出的决策、完成的任务
2. 突出重点：强调重要的代码实现、架构设计、技术选型
3. 结构化输出：使用Markdown格式，包含：
   - 📌 核心议题
   - 🎯 技术决策
   - ✅ 已完成事项
   - ⏸️ 待办事项（如有）
4. 保留上下文：确保未来对话可以基于摘要继续

摘要长度：300-500字。`;
  }

  /**
   * 获取最后一次摘要
   */
  private async getLastSummary(sessionId: string): Promise<Summary | null> {
    return await this.summaryRepo.findOne({
      where: { sessionId },
      order: { createdAt: 'DESC' },
    });
  }
}

// src/tasks/processors/memory-tasks.processor.ts
@Processor('memory-tasks')
export class MemoryTasksProcessor {
  constructor(
    private readonly summarizationService: SummarizationService,
    private readonly sessionRepo: SessionRepository,
  ) {}

  /**
   * 每小时检查并生成摘要
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduleSummarization() {
    console.log('🔄 开始检查需要摘要的会话...');

    const activeSessions = await this.sessionRepo.find({
      where: { status: 'active' },
    });

    for (const session of activeSessions) {
      const shouldSummarize = await this.summarizationService.shouldSummarize(session.id);

      if (shouldSummarize) {
        await this.memoryQueue.add('generate-summary', { sessionId: session.id });
      }
    }
  }

  @Process('generate-summary')
  async handleGenerateSummary(job: Job<{ sessionId: string }>) {
    const { sessionId } = job.data;

    try {
      const summary = await this.summarizationService.generateSummary(sessionId);
      await this.summarizationService.saveSummary(sessionId, summary);

      console.log(`✅ 会话摘要完成: ${sessionId}`);
    } catch (error) {
      console.error(`❌ 摘要生成失败: ${sessionId}`, error);
      throw error; // 触发重试
    }
  }
}
```

**验收标准**：
- ✅ 超过50条消息自动触发摘要
- ✅ 摘要质量高、结构清晰
- ✅ 摘要已向量化并可检索
- ✅ Agent可以基于摘要回答问题

---

### Day 8-9: LangGraph 结构化工作流（可选）

#### 任务 16.1: LangGraph 集成

**目标**：实现结构化工作流模式切换。

**文件**：
- `src/langgraph/langgraph.module.ts` [NEW]
- `src/langgraph/services/orchestrator.service.ts` [NEW]
- `src/langgraph/workflows/requirement-analysis.workflow.ts` [NEW]

**子任务**：

```
□ 安装依赖
  npm install @langchain/langgraph @langchain/core
  预计: 15分钟

□ 创建 OrchestratorService
  - 工作流注册表
  - 执行引擎
  预计: 3小时

□ 实现示例工作流（需求分析）
  - 定义节点：收集需求 → 分析 → 设计 → 评审
  - 定义边：控制流转
  预计: 4小时

□ 模式切换
  - 用户可以切换自由对话 ↔ 结构化工作流
  - 通过 /workflow start <workflow-name> 触发
  预计: 2小时

□ 测试
  预计: 2小时
```

**实现示例**：

```typescript
// src/langgraph/workflows/requirement-analysis.workflow.ts
import { StateGraph } from '@langchain/langgraph';

export class RequirementAnalysisWorkflow {
  private graph: StateGraph;

  constructor(
    private readonly claudeAgent: ClaudeAdapter,
    private readonly codexAgent: CodexAdapter,
    private readonly geminiAgent: GeminiAdapter,
  ) {
    this.buildGraph();
  }

  private buildGraph() {
    this.graph = new StateGraph({
      channels: {
        requirements: null,
        analysis: null,
        design: null,
        review: null,
      },
    });

    // 节点1: 收集需求（用户输入）
    this.graph.addNode('collect_requirements', async (state) => {
      // 等待用户输入需求
      return {
        ...state,
        requirements: await this.promptUser('请描述您的需求：'),
      };
    });

    // 节点2: 需求分析（Claude）
    this.graph.addNode('analyze_requirements', async (state) => {
      const prompt = `作为需求分析师，请分析以下需求：\n\n${state.requirements}`;
      const response = await this.claudeAgent.generate(prompt, {});

      return {
        ...state,
        analysis: response.content,
      };
    });

    // 节点3: 架构设计（Claude）
    this.graph.addNode('design_architecture', async (state) => {
      const prompt = `基于需求分析，设计系统架构：\n\n${state.analysis}`;
      const response = await this.claudeAgent.generate(prompt, {});

      return {
        ...state,
        design: response.content,
      };
    });

    // 节点4: 代码审查（Codex）
    this.graph.addNode('review_design', async (state) => {
      const prompt = `审查以下架构设计：\n\n${state.design}`;
      const response = await this.codexAgent.generate(prompt, {});

      return {
        ...state,
        review: response.content,
      };
    });

    // 节点5: 输出文档（汇总）
    this.graph.addNode('output_document', async (state) => {
      const document = this.generateDocument(state);
      await this.saveDocument(document);
      return state;
    });

    // 定义边（流程控制）
    this.graph.addEdge('__start__', 'collect_requirements');
    this.graph.addEdge('collect_requirements', 'analyze_requirements');
    this.graph.addEdge('analyze_requirements', 'design_architecture');
    this.graph.addEdge('design_architecture', 'review_design');
    this.graph.addEdge('review_design', 'output_document');
    this.graph.addEdge('output_document', '__end__');

    this.graph.setEntryPoint('collect_requirements');
  }

  async execute(sessionId: string): Promise<void> {
    const runnable = this.graph.compile();
    const result = await runnable.invoke({});

    console.log('✅ 工作流执行完成', result);
  }
}
```

**验收标准**（可选）：
- ✅ 可以启动结构化工作流
- ✅ Agent按预定义顺序执行
- ✅ 输出结构化文档
- ✅ 可以随时退出回到自由对话

---

### Day 10: 性能优化与监控

#### 任务 17.1: 性能优化

**子任务**：

```
□ 数据库查询优化
  - 添加缺失索引
  - 优化 N+1 查询
  - 使用 EXPLAIN ANALYZE 分析慢查询
  预计: 2小时

□ Redis 缓存优化
  - 增加缓存命中率监控
  - 优化 TTL 策略
  - 使用 Pipeline 批量操作
  预计: 2小时

□ WebSocket 优化
  - 消息节流（50ms合并）
  - 压缩大消息
  预计: 1.5小时

□ Agent 调用优化
  - 超时控制
  - 并行调用优化
  - 失败快速返回
  预计: 1.5小时
```

---

#### 任务 17.2: 监控告警

**文件**：
- `src/monitoring/monitoring.module.ts` [NEW]
- `src/monitoring/services/metrics.service.ts` [NEW]

**子任务**：

```
□ 安装依赖
  npm install @willsoto/nestjs-prometheus prom-client
  预计: 15分钟

□ 集成 Prometheus
  - 暴露 /metrics 端点
  - 注册自定义指标
  预计: 2小时

□ 核心指标
  - HTTP请求延迟（Histogram）
  - WebSocket连接数（Gauge）
  - Agent调用次数（Counter）
  - Redis命中率（Gauge）
  - 消息吞吐量（Counter）
  预计: 3小时

□ Grafana Dashboard
  - 导入预设Dashboard
  - 配置告警规则
  预计: 2小时
```

**实现示例**：

```typescript
// src/monitoring/services/metrics.service.ts
import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Gauge, register } from 'prom-client';

@Injectable()
export class MetricsService {
  // HTTP请求延迟
  public readonly httpRequestDuration: Histogram;

  // WebSocket连接数
  public readonly wsConnectionsGauge: Gauge;

  // Agent调用计数
  public readonly agentCallsCounter: Counter;

  // Redis命中率
  public readonly redisCacheHitRate: Gauge;

  constructor() {
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_ms',
      help: 'HTTP request duration in milliseconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
    });

    this.wsConnectionsGauge = new Gauge({
      name: 'ws_connections_active',
      help: 'Number of active WebSocket connections',
    });

    this.agentCallsCounter = new Counter({
      name: 'agent_calls_total',
      help: 'Total number of agent calls',
      labelNames: ['agent_id', 'agent_name', 'status'],
    });

    this.redisCacheHitRate = new Gauge({
      name: 'redis_cache_hit_rate',
      help: 'Redis cache hit rate (0-1)',
    });
  }

  getMetrics(): string {
    return register.metrics();
  }
}

// src/monitoring/monitoring.controller.ts
@Controller()
export class MonitoringController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('/metrics')
  getMetrics(): string {
    return this.metricsService.getMetrics();
  }

  @Get('/health')
  async getHealth(): Promise<HealthStatus> {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        database: await this.checkDatabase(),
        redis: await this.checkRedis(),
        chromadb: await this.checkChromaDB(),
      },
    };
  }
}
```

**验收标准**：
- ✅ Prometheus可以抓取 /metrics
- ✅ Grafana Dashboard显示实时指标
- ✅ 告警规则触发正常（模拟异常）

---

## Sprint 3 验收标准

### 功能验收

```
✅ 核心功能
  □ Agent健康检查每5分钟自动执行
  □ 过期会话每天自动清理
  □ 数据库每天自动备份
  □ 对话超过50条自动生成摘要
  □ 语义检索可以找到相关历史消息
  □ 结构化工作流可以执行（可选）
  □ /metrics 端点返回Prometheus格式指标

✅ 性能
  □ 向量检索 < 500ms
  □ 摘要生成 < 10s
  □ Cron任务准时执行（±5s误差）
  □ 缓存命中率 > 80%
```

### 技术验收

```
✅ 代码质量
  □ npm run lint 零错误
  □ npm run build 成功
  □ 单元测试覆盖率 ≥ 75%
  □ E2E 测试覆盖核心场景

✅ 运维
  □ Prometheus正常抓取指标
  □ Grafana Dashboard可视化正常
  □ 日志结构化输出
  □ 健康检查端点正常
```

---

## Sprint 3 交付物

```
版本: v0.3.0
Tag:  sprint-3-enhance

交付内容:
✅ BullMQ 任务队列
✅ 6个定时任务（健康检查/清理/备份/摘要等）
✅ ChromaDB 向量检索
✅ 自动记忆摘要（GPT-4o-mini）
✅ LangGraph 工作流（可选）
✅ Prometheus 监控指标
✅ Grafana Dashboard
✅ 性能优化
✅ 压力测试报告
```

---

## 新增依赖

```bash
# Sprint 3 新增依赖
npm install @nestjs/bull bull bullmq
npm install chromadb openai
npm install @langchain/langgraph @langchain/core  # 可选
npm install @willsoto/nestjs-prometheus prom-client
npm install -D @types/bull
```

---

## 目录结构变更

Sprint 3 结束后新增的文件：

```
src/
├── tasks/                              [NEW MODULE]
│   ├── tasks.module.ts
│   ├── processors/
│   │   ├── scheduled-tasks.processor.ts
│   │   └── memory-tasks.processor.ts
│   └── queues/
│       └── background-tasks.queue.ts
├── vector/                             [NEW MODULE]
│   ├── vector.module.ts
│   └── services/
│       ├── chroma.service.ts
│       ├── embedding.service.ts
│       └── search.service.ts
├── langgraph/                          [NEW MODULE, 可选]
│   ├── langgraph.module.ts
│   ├── services/
│   │   └── orchestrator.service.ts
│   └── workflows/
│       ├── requirement-analysis.workflow.ts
│       └── code-review.workflow.ts
├── monitoring/                         [NEW MODULE]
│   ├── monitoring.module.ts
│   ├── monitoring.controller.ts
│   └── services/
│       └── metrics.service.ts
├── memory/
│   └── services/
│       └── summarization.service.ts    [NEW]
└── agents/
    └── services/
        └── context-builder.service.ts  [NEW]
```

---

## 任务优先级排序

| 优先级 | 任务 | 天数 | 依赖 |
|--------|------|------|------|
| P0 | 13.1 BullMQ基础设施 | Day 1 | 无 |
| P0 | 13.2 定时任务实现 | Day 1-2 | 13.1 |
| P0 | 14.1 ChromaDB集成 | Day 3-4 | 无 |
| P0 | 14.2 语义检索集成 | Day 4 | 14.1 |
| P1 | 15.1 记忆摘要服务 | Day 6-7 | 14.1 |
| P2 | 16.1 LangGraph集成 | Day 8-9 | 无（可选） |
| P1 | 17.1 性能优化 | Day 10 | 无 |
| P1 | 17.2 监控告警 | Day 10 | 无 |

---

## 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| ChromaDB性能不足 | 中 | 高 | 优化向量索引，考虑Pinecone/Weaviate替代 |
| 摘要质量不佳 | 中 | 中 | 调优提示词，增加few-shot示例 |
| 定时任务堆积 | 低 | 中 | 设置并发限制，优先级队列 |
| OpenAI API超时 | 中 | 中 | 增加重试，设置更长超时 |
| Prometheus数据量大 | 低 | 低 | 设置数据保留期（7天） |

---

## 下一步：Sprint 4

Sprint 3 完成后进入 Sprint 4 - 生产就绪：

```
Sprint 4 重点:
□ JWT 认证授权
□ RBAC 权限管理
□ 安全加固（HTTPS/CORS/速率限制/SQL注入防护）
□ CI/CD 流水线
□ Kubernetes 部署配置
□ 压力测试与调优
□ 文档完善
□ 生产环境部署
```

---

**文档版本**: v1.0.0  
**最后更新**: 2026-02-23  
**Sprint状态**: 待开始
