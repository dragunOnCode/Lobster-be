# OpenClaw架构深度分析与Lobster实现对比

> 从OpenClaw学习什么，改进什么，以及如何实现  
> 版本：v1.0.0  
> 日期：2026-02-18

---

## 📋 目录

- [OpenClaw架构剖析](#openclaw架构剖析)
- [关键设计决策对比](#关键设计决策对比)
- [值得借鉴的核心组件](#值得借鉴的核心组件)
- [Lobster的架构创新](#lobster的架构创新)
- [具体实现指南](#具体实现指南)

---

## OpenClaw架构剖析

### 核心架构：Hub-and-Spoke模式

OpenClaw使用**单一网关（Hub）+ 多Agent（Spoke）**的架构：

```
Channels (WhatsApp/Telegram/Discord/iMessage)
              ↓
       ┌──────────────┐
       │   Gateway    │  ← 唯一的Hub
       │ (单一进程)    │
       └──────┬───────┘
              │
    ┌─────────┼─────────┐
    ↓         ↓         ↓
  Agent1    Agent2    Agent3  ← Spokes
```

**关键特点**：
1. **Gateway是唯一持有会话的进程**
2. **所有Channel通过Gateway路由**
3. **Agent通过RPC与Gateway通信**
4. **默认绑定到localhost（安全）**

### OpenClaw的6大核心组件

#### 1. Gateway（网关）

**职责**：
- ✅ 管理所有Channel连接（WhatsApp/Telegram等）
- ✅ 会话路由（main/group/isolated）
- ✅ 控制平面（70+ RPC方法）
- ✅ Config热重载
- ✅ Cron服务
- ✅ mDNS/Bonjour发现

**监听端口**：
- `ws://127.0.0.1:18789` - WebSocket API
- `http://:18793/__openclaw__/canvas/` - Canvas Host

#### 2. Agent Loop（Agent执行循环）

**消息流**：
```
接收消息 → 路由到会话 → 加载上下文&技能 → 调用LLM → 执行工具 → 流式响应 → 持久化
```

**关键点**：
- 每条消息都经历完整的循环
- 上下文从Workspace加载
- 工具执行结果流式返回

#### 3. Session Model（会话模型）

**三种会话类型**：
- **main session**：私聊共享一个会话
- **group session**：每个群组独立会话
- **isolated session**：特定联系人/安全需求

**特性**：
- 每个会话有独立的上下文和历史
- 可配置激活规则（总是回复 vs 仅@提及时）
- 支持消息队列（处理并发）

#### 4. Workspace Structure（工作空间结构）

**文件系统存储**：
```
~/.clawdbot/
├── moltbot.json              # 配置文件
└── credentials/              # 凭证

~/clawd/                      # 工作空间根目录
├── AGENTS.md                 # Agent配置
├── SOUL.md                   # Agent人格
├── TOOLS.md                  # 工具定义
├── skills/                   # 技能
│   └── {skill-name}/
│       └── SKILL.md
└── memories/                 # 记忆文件（按日期）
    ├── 2026-02-18.md
    └── transcripts.jsonl
```

**优势**：
- ✅ 人类可读（Markdown）
- ✅ 可编辑（普通编辑器）
- ✅ 可搜索（Raycast/Obsidian）
- ✅ 可版本化（Git）
- ✅ 可备份（标准文件工具）

#### 5. Multi-agent Routing（多Agent路由）

**特性**：
- 不同Channel可以路由到不同Agent
- 每个Agent有独立的Workspace
- 一个Gateway管理多个Workspace

**示例**：
```
Gateway
  ├─ workspace1/ (客服Agent，处理Telegram)
  ├─ workspace2/ (技术Agent，处理Discord)
  └─ workspace3/ (个人助理，处理WhatsApp)
```

#### 6. 插件系统（4类扩展点）

| 插件类型 | 用途 | 示例 |
|---------|------|------|
| Provider | 自定义LLM | 本地Ollama、Azure OpenAI |
| Tool | 自定义工具 | 数据库查询、API调用 |
| Memory | 替代存储 | S3、Notion同步 |
| Channel | 新消息平台 | Matrix、Slack |

---

## 关键设计决策对比

### 决策1：网关架构

| 维度 | OpenClaw | Lobster | 分析 |
|------|----------|---------|------|
| **架构模式** | Hub-and-Spoke | ✅ 采用 | 清晰的中心化管理 |
| **Gateway数量** | 单一进程 | ✅ 单一进程 | 避免状态同步问题 |
| **会话管理** | Gateway持有 | ✅ Gateway持有 | 统一路由 |
| **绑定地址** | Localhost only | ✅ 采用（开发），生产配置CORS | 安全优先 |

**结论**：✅ **完全采用OpenClaw的Hub-and-Spoke架构**

### 决策2：存储策略

| 维度 | OpenClaw | Lobster | 分析 |
|------|----------|---------|------|
| **配置存储** | JSON文件 | ✅ JSON文件 | 可读性好 |
| **提示词** | Markdown文件 | ✅ 采用 + 数据库 | 文件+DB双存储 |
| **记忆** | Markdown按日期 | ⚠️ 改进：Redis+PostgreSQL+文件 | 实时性更强 |
| **会话记录** | JSONL | ✅ 采用 | 审计友好 |
| **代码文件** | 文件系统 | ✅ 文件系统+MinIO | 本地+云存储 |

**结论**：✅ **采用文件系统 + 增强实时存储**

**改进点**：
- OpenClaw的记忆是纯文件（按日期存储）
- Lobster增加Redis缓存（实时访问）
- 保留文件系统（可审计）

### 决策3：Agent模式

| 维度 | OpenClaw | Lobster | 分析 |
|------|----------|---------|------|
| **Agent数量** | 单Agent | ✅ 多Agent | 核心差异 |
| **交互模式** | 一对一（用户↔Agent） | ✅ 群聊（多Agent互动） | 创新点 |
| **Agent路由** | 按Channel路由 | 按@提及+主动决策 | 更智能 |
| **上下文隔离** | 多Workspace | 单Workspace共享 | 更协作 |

**结论**：⚠️ **架构相同，交互模式创新**

**Lobster创新**：
- OpenClaw：一个用户 ↔ 一个Agent（可切换不同Agent）
- Lobster：一个用户 ↔ 多个Agent同时在线（群聊）

### 决策4：扩展性

| 维度 | OpenClaw | Lobster | 分析 |
|------|----------|---------|------|
| **插件系统** | 4类插件 | ✅ 采用 | 高扩展性 |
| **Config热重载** | ✅ 文件watcher | ✅ 采用 | 开发友好 |
| **多Workspace** | ✅ 支持 | ⚠️ 单Workspace共享 | 简化设计 |

**结论**：✅ **采用插件化 + 简化Workspace管理**

---

## 值得借鉴的核心组件

### ✅ 组件1：单一Gateway架构

**OpenClaw实现精华**：
```typescript
// Gateway是唯一的会话持有者
class Gateway {
  private sessions: Map<string, Session> = new Map();
  private channelMonitors: Map<string, ChannelMonitor> = new Map();
  
  // 所有消息通过Gateway路由
  async routeMessage(message: IncomingMessage) {
    const session = this.getOrCreateSession(message);
    await this.processMessage(session, message);
  }
}
```

**Lobster实现**：
```typescript
@WebSocketGateway({ namespace: '/chat', cors: true })
export class ChatGateway {
  // 会话管理器（单例，所有连接共享）
  constructor(private readonly sessionManager: SessionManager) {}
  
  @SubscribeMessage('message:send')
  async handleMessage(client: Socket, data: MessageDto) {
    const session = this.sessionManager.getSession(data.sessionId);
    await this.routeToAgents(session, data);
  }
}
```

**优势**：
- ✅ 简化架构：只有一个地方管理状态
- ✅ 易于调试：集中式日志
- ✅ 易于监控：单点性能追踪

### ✅ 组件2：文件系统工作空间

**OpenClaw实现精华**：

工作空间使用文件系统，所有状态可审计：
- 配置文件：JSON格式
- 提示词：Markdown格式
- 记忆：Markdown（按日期）+ JSONL（转录）
- 技能：Markdown格式

**Lobster实现（增强版）**：

```typescript
@Injectable()
export class WorkspaceFileSystem {
  private readonly workspaceRoot = 'workspace';
  
  /**
   * 会话目录结构
   */
  getSessionPath(sessionId: string): string {
    return path.join(this.workspaceRoot, 'sessions', sessionId);
  }
  
  /**
   * 初始化会话工作空间
   */
  async initializeSession(sessionId: string) {
    const sessionPath = this.getSessionPath(sessionId);
    
    await fs.ensureDir(path.join(sessionPath, 'code'));
    await fs.ensureDir(path.join(sessionPath, 'docs'));
    
    // 创建初始文件
    await fs.writeFile(
      path.join(sessionPath, 'metadata.json'),
      JSON.stringify({
        sessionId,
        createdAt: new Date(),
        agents: [],
        techStack: {}
      }, null, 2)
    );
    
    await fs.writeFile(
      path.join(sessionPath, 'transcripts.jsonl'),
      ''
    );
    
    await fs.writeFile(
      path.join(sessionPath, 'decisions.md'),
      '# 技术决策记录\n\n'
    );
    
    await fs.writeFile(
      path.join(sessionPath, 'tasks.md'),
      '# 任务清单\n\n'
    );
  }
  
  /**
   * 保存代码文件
   */
  async saveCodeFile(sessionId: string, file: CodeFile) {
    const filePath = path.join(
      this.getSessionPath(sessionId),
      'code',
      file.path
    );
    
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, file.content);
    
    // 同步记录到transcript
    await this.appendTranscript(sessionId, {
      timestamp: new Date(),
      type: 'file_created',
      path: file.path,
      author: file.author,
      language: file.language,
      linesOfCode: file.content.split('\n').length
    });
  }
  
  /**
   * 追加转录记录（JSONL格式）
   */
  async appendTranscript(sessionId: string, entry: any) {
    const transcriptPath = path.join(
      this.getSessionPath(sessionId),
      'transcripts.jsonl'
    );
    
    await fs.appendFile(
      transcriptPath,
      JSON.stringify({
        ...entry,
        timestamp: entry.timestamp || new Date()
      }) + '\n'
    );
  }
  
  /**
   * 读取会话历史（从JSONL）
   */
  async readTranscript(sessionId: string): Promise<any[]> {
    const transcriptPath = path.join(
      this.getSessionPath(sessionId),
      'transcripts.jsonl'
    );
    
    const content = await fs.readFile(transcriptPath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  }
  
  /**
   * 导出会话（用于备份/分享）
   */
  async exportSession(sessionId: string): Promise<Buffer> {
    const sessionPath = this.getSessionPath(sessionId);
    
    // 打包整个会话目录为zip
    const archive = archiver('zip');
    archive.directory(sessionPath, false);
    archive.finalize();
    
    return archive;
  }
}
```

**优势**：
1. **可审计**：所有操作都有文件记录
2. **可调试**：直接打开文件查看
3. **可搜索**：使用Grep/Ripgrep搜索
4. **可备份**：标准文件系统工具
5. **可版本化**：Git友好
6. **可分享**：导出zip即可

### ✅ 组件3：Config Hot-reload（配置热重载）

**OpenClaw实现**：使用文件系统watcher监听配置变化，自动重载。

**Lobster实现**：

```typescript
@Injectable()
export class ConfigWatcherService implements OnModuleInit {
  constructor(
    private readonly agentConfigService: AgentConfigService,
    private readonly promptService: PromptService,
    private readonly eventEmitter: EventEmitter2
  ) {}
  
  async onModuleInit() {
    const watcher = chokidar.watch([
      'config/agents.config.json',
      'config/prompts/**/*.md',
      'workspace/sessions/*/decisions.md',
      'workspace/sessions/*/tasks.md'
    ], {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500, // 等待500ms确保写入完成
        pollInterval: 100
      }
    });
    
    watcher.on('change', async (filePath) => {
      console.log(`📝 文件变更: ${filePath}`);
      
      try {
        if (filePath.includes('agents.config.json')) {
          await this.reloadAgents();
        } else if (filePath.includes('prompts')) {
          await this.reloadPrompts();
        } else if (filePath.includes('decisions.md')) {
          await this.syncDecisionsToDatabase(filePath);
        } else if (filePath.includes('tasks.md')) {
          await this.syncTasksToDatabase(filePath);
        }
      } catch (error) {
        console.error(`❌ 重载失败: ${filePath}`, error);
      }
    });
    
    console.log('✅ Config Watcher已启动');
  }
  
  private async reloadAgents() {
    const startTime = Date.now();
    
    // 重新加载Agent配置
    await this.agentConfigService.loadAgentsFromConfig();
    
    // 触发事件
    this.eventEmitter.emit('config.agents.reloaded', {
      timestamp: new Date(),
      duration: Date.now() - startTime
    });
    
    // 通知所有在线客户端
    this.socketGateway.broadcast('system:notification', {
      type: 'agents_reloaded',
      message: 'Agent配置已更新',
      timestamp: new Date()
    });
    
    console.log(`✅ Agent配置重载完成 (${Date.now() - startTime}ms)`);
  }
  
  private async reloadPrompts() {
    await this.promptService.loadPromptsFromFiles();
    this.eventEmitter.emit('config.prompts.reloaded');
    console.log('✅ 提示词模板重载完成');
  }
}
```

**使用场景**：

```bash
# 开发时实时调整Agent配置
vim config/agents.config.json
# 修改Claude的temperature从0.7改为0.8
# 保存文件

# 系统自动检测并重载（无需重启！）
[NestJS] 📝 文件变更: config/agents.config.json
[NestJS] ✅ Agent配置重载完成 (45ms)

# 前端自动收到通知
[Frontend] 系统通知：Agent配置已更新
```

### ✅ 组件4：Cron服务（定时任务）

**OpenClaw实现**：内置Cron服务，处理定期清理、备份、健康检查。

**Lobster实现（使用BullMQ + NestJS Schedule）**：

```typescript
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class ScheduledTasksService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly memoryService: MemoryService,
    private readonly agentService: AgentService,
    private readonly workspaceService: WorkspaceService
  ) {}
  
  /**
   * 每5分钟：Agent健康检查
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async healthCheckAgents() {
    console.log('🏥 执行Agent健康检查...');
    
    const agents = await this.agentService.getAllAgents();
    const results = await Promise.allSettled(
      agents.map(agent => agent.healthCheck())
    );
    
    results.forEach((result, index) => {
      const agent = agents[index];
      if (result.status === 'rejected' || !result.value) {
        console.warn(`⚠️ Agent ${agent.name} 健康检查失败`);
        // 更新状态为offline
        this.agentService.updateStatus(agent.id, 'offline');
      } else {
        this.agentService.updateStatus(agent.id, 'online');
      }
    });
  }
  
  /**
   * 每小时：记忆摘要生成
   */
  @Cron(CronExpression.EVERY_HOUR)
  async summarizeMemories() {
    console.log('📝 执行记忆摘要...');
    
    const activeSessions = await this.sessionService.findActive();
    
    for (const session of activeSessions) {
      const shouldSummarize = await this.memoryService.shouldSummarize(session.id);
      
      if (shouldSummarize) {
        const summary = await this.memoryService.generateSummary(session.id);
        
        // 保存到文件
        await this.workspaceService.saveDocument(session.id, {
          title: `摘要-${new Date().toISOString()}`,
          content: summary,
          category: 'summary'
        });
        
        // 追加到transcript
        await this.workspaceService.appendTranscript(session.id, {
          type: 'memory_summarized',
          summary: summary.substring(0, 200),
          messageCount: await this.memoryService.getMessageCount(session.id)
        });
      }
    }
  }
  
  /**
   * 每天凌晨2点：清理过期会话
   */
  @Cron('0 2 * * *')
  async cleanupExpiredSessions() {
    console.log('🗑️ 清理过期会话...');
    
    const expiredDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30天前
    const expired = await this.sessionService.findExpired(expiredDate);
    
    for (const session of expired) {
      // 归档到云存储
      const archive = await this.workspaceService.exportSession(session.id);
      await this.storageService.uploadArchive(session.id, archive);
      
      // 删除本地文件
      await this.workspaceService.deleteSession(session.id);
      
      // 更新数据库
      session.status = 'archived';
      await this.sessionService.save(session);
    }
    
    console.log(`✅ 已清理 ${expired.length} 个过期会话`);
  }
  
  /**
   * 每天凌晨3点：备份数据库
   */
  @Cron('0 3 * * *')
  async backupDatabase() {
    console.log('💾 执行数据库备份...');
    
    // 执行pg_dump
    const dumpFile = `backup-${new Date().toISOString()}.sql`;
    await this.databaseService.backup(dumpFile);
    
    // 上传到MinIO
    await this.storageService.uploadBackup(dumpFile);
    
    console.log('✅ 数据库备份完成');
  }
  
  /**
   * 每周日凌晨4点：清理向量数据库
   */
  @Cron('0 4 * * 0')
  async cleanupVectorStore() {
    console.log('🧹 清理向量数据库...');
    
    // 删除超过60天的向量
    const cutoffDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await this.vectorStore.deleteOlderThan(cutoffDate);
    
    console.log('✅ 向量数据库清理完成');
  }
}
```

### ✅ 组件5：Transcript日志系统（JSONL）

**OpenClaw实现精华**：使用JSONL格式记录所有事件。

**为什么JSONL而非JSON？**
- ✅ 追加友好：不需要解析整个文件
- ✅ 流式处理：逐行读取
- ✅ 容错性好：单行损坏不影响其他行
- ✅ 日志友好：类似传统日志格式

**Lobster实现**：

```typescript
@Injectable()
export class TranscriptService {
  /**
   * 记录事件到transcript
   */
  async log(sessionId: string, event: TranscriptEvent) {
    const transcriptPath = this.getTranscriptPath(sessionId);
    
    const entry = {
      timestamp: new Date().toISOString(),
      ...event
    };
    
    // 追加到JSONL文件
    await fs.appendFile(
      transcriptPath,
      JSON.stringify(entry) + '\n'
    );
    
    // 同时发送到日志系统（Pino）
    this.logger.info(entry, 'Transcript');
  }
  
  /**
   * 读取transcript（支持过滤）
   */
  async read(
    sessionId: string,
    filter?: {
      type?: string;
      since?: Date;
      limit?: number;
    }
  ): Promise<TranscriptEvent[]> {
    const transcriptPath = this.getTranscriptPath(sessionId);
    const content = await fs.readFile(transcriptPath, 'utf-8');
    
    let events = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    
    // 应用过滤
    if (filter?.type) {
      events = events.filter(e => e.type === filter.type);
    }
    
    if (filter?.since) {
      events = events.filter(e => new Date(e.timestamp) >= filter.since);
    }
    
    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }
    
    return events;
  }
  
  /**
   * 生成会话报告
   */
  async generateReport(sessionId: string): Promise<SessionReport> {
    const events = await this.read(sessionId);
    
    return {
      totalMessages: events.filter(e => e.type === 'message').length,
      agentResponses: events.filter(e => e.type === 'message' && e.role === 'assistant').length,
      filesCreated: events.filter(e => e.type === 'file_created').length,
      decisionsCount: events.filter(e => e.type === 'decision').length,
      duration: this.calculateDuration(events),
      participants: this.getParticipants(events)
    };
  }
}

// Transcript事件类型
type TranscriptEvent = 
  | { type: 'message'; role: string; content: string; userId?: string; agentId?: string }
  | { type: 'agent_decision'; agent: string; decision: 'respond' | 'skip'; reason: string }
  | { type: 'file_created'; path: string; author: string; language: string; linesOfCode: number }
  | { type: 'file_updated'; path: string; author: string; version: number; changeSummary: string }
  | { type: 'task_created'; title: string; assignedTo?: string }
  | { type: 'task_completed'; title: string; completedBy: string }
  | { type: 'decision'; title: string; decision: string; participants: string[] }
  | { type: 'error'; error: string; context: any };
```

**使用场景**：

```typescript
// 场景1：调试问题
const events = await transcriptService.read('session-123', {
  type: 'error',
  since: new Date('2026-02-18')
});
console.log('所有错误:', events);

// 场景2：统计Agent贡献
const agentContributions = {};
const events = await transcriptService.read('session-123');

events.filter(e => e.type === 'file_created').forEach(e => {
  agentContributions[e.author] = (agentContributions[e.author] || 0) + 1;
});

console.log('Agent贡献度:', agentContributions);
// { 'claude-001': 15, 'gemini-001': 5, 'codex-001': 8 }

// 场景3：生成会话摘要
const report = await transcriptService.generateReport('session-123');
// 总消息数: 156
// Agent响应: 87
// 创建文件: 23
// 技术决策: 8
```

### ✅ 组件6：插件化扩展系统

**OpenClaw的4类插件**：

1. **Provider插件**（LLM提供商）
2. **Tool插件**（自定义工具）
3. **Memory插件**（存储后端）
4. **Channel插件**（消息平台）

**Lobster实现**：

```typescript
// 1. Agent Provider插件接口
interface IAgentProvider {
  readonly type: string;
  readonly name: string;
  
  create(config: AgentConfig): ILLMAdapter;
  validate(config: AgentConfig): boolean;
}

// 2. 实现自定义Provider
@Injectable()
export class OllamaAgentProvider implements IAgentProvider {
  readonly type = 'ollama';
  readonly name = 'Ollama Local Models';
  
  create(config: AgentConfig): ILLMAdapter {
    return new OllamaAdapter(config);
  }
  
  validate(config: AgentConfig): boolean {
    return !!config.config.modelName;
  }
}

// 3. 注册Provider
@Module({
  providers: [
    {
      provide: 'AGENT_PROVIDERS',
      useFactory: () => [
        new ClaudeAgentProvider(),
        new CodexAgentProvider(),
        new GeminiAgentProvider(),
        new OllamaAgentProvider(), // 自定义Provider
      ]
    }
  ]
})
export class AgentModule {}

// 4. Agent Factory（工厂模式）
@Injectable()
export class AgentFactory {
  constructor(
    @Inject('AGENT_PROVIDERS') private readonly providers: IAgentProvider[]
  ) {}
  
  createAgent(config: AgentConfig): ILLMAdapter {
    const provider = this.providers.find(p => p.type === config.type);
    
    if (!provider) {
      throw new Error(`Unknown agent type: ${config.type}`);
    }
    
    if (!provider.validate(config)) {
      throw new Error(`Invalid config for ${config.type}`);
    }
    
    return provider.create(config);
  }
}
```

**Tool插件示例**：

```typescript
// Tool插件接口
interface IToolPlugin {
  name: string;
  description: string;
  schema: JsonSchema;
  execute(params: any, context: ToolContext): Promise<any>;
}

// 实现自定义Tool
@Injectable()
export class DatabaseQueryTool implements IToolPlugin {
  name = 'database_query';
  description = '执行数据库查询';
  schema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'SQL查询语句' },
      params: { type: 'array', description: '查询参数' }
    },
    required: ['query']
  };
  
  async execute(params: any, context: ToolContext): Promise<any> {
    // 安全检查
    if (!this.isSafeQuery(params.query)) {
      throw new Error('不安全的查询');
    }
    
    // 执行查询
    const result = await this.database.query(params.query, params.params);
    return result;
  }
}

// Tool Registry
@Injectable()
export class ToolRegistry {
  private tools: Map<string, IToolPlugin> = new Map();
  
  register(tool: IToolPlugin) {
    this.tools.set(tool.name, tool);
  }
  
  get(name: string): IToolPlugin {
    return this.tools.get(name);
  }
  
  listAll(): IToolPlugin[] {
    return Array.from(this.tools.values());
  }
}
```

---

## Lobster的架构创新

### 创新1：多Agent群聊式交互

**OpenClaw**：
- 用户 ↔ 单个Agent（一对一）
- 可以切换不同Agent（不同Workspace）

**Lobster**：
- 用户 ↔ 多个Agent同时在线（群聊）
- 所有Agent共享一个Workspace
- Agent可以互相对话

**架构影响**：

```typescript
// OpenClaw风格（一对一）
Gateway → 选择Agent → 单Agent响应

// Lobster风格（群聊）
Gateway → 广播给所有Agent → 多Agent并行决策 → 多Agent可能响应
```

### 创新2：Agent主动感知机制

**OpenClaw**：
- 被动响应：消息到达才处理
- 路由规则：按Channel/Contact配置

**Lobster**：
- 主动感知：Agent监听所有消息并决策
- 智能路由：Agent自己判断是否响应

**实现差异**：

```typescript
// OpenClaw: 路由到指定Agent
if (message.channel === 'telegram') {
  agent = getAgentForWorkspace('support');
} else {
  agent = getAgentForWorkspace('personal');
}

// Lobster: 让所有Agent自己决策
const decisions = await Promise.all(
  agents.map(agent => agent.shouldRespond(message, context))
);

// 可能有0个、1个或多个Agent响应
```

### 创新3：共享工作空间

**OpenClaw**：
- 多Workspace：每个Agent独立Workspace
- 上下文隔离：不同Agent看不到其他Agent的内容

**Lobster**：
- 单Workspace：所有Agent共享
- 上下文共享：Agent之间可以协作

**架构对比**：

```
OpenClaw:
Gateway
  ├─ workspace1/ (Agent A)
  ├─ workspace2/ (Agent B)
  └─ workspace3/ (Agent C)
  [相互隔离]

Lobster:
Gateway
  └─ workspace/
      └─ session-123/
          ├─ code/ (所有Agent共同维护)
          ├─ tasks.md (所有Agent可见)
          └─ transcripts.jsonl (记录所有Agent活动)
  [完全共享]
```

---

## 具体实现指南

### 第一步：搭建Gateway骨架

```typescript
// src/gateway/gateway.module.ts
@Module({
  imports: [
    ConfigModule,
    SessionModule,
    AgentModule,
    MemoryModule,
    WorkspaceModule
  ],
  providers: [ChatGateway, SessionManager, MessageRouter]
})
export class GatewayModule {}

// src/gateway/chat.gateway.ts
@WebSocketGateway({ 
  namespace: '/chat',
  cors: { origin: '*' } // 开发环境，生产需配置
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly messageRouter: MessageRouter
  ) {}
  
  afterInit(server: Server) {
    console.log('✅ WebSocket Gateway初始化完成');
  }
  
  async handleConnection(client: Socket) {
    console.log(`🔌 客户端连接: ${client.id}`);
    // 实现连接逻辑
  }
  
  handleDisconnect(client: Socket) {
    console.log(`❌ 客户端断开: ${client.id}`);
    // 实现断开逻辑
  }
  
  @SubscribeMessage('message:send')
  async handleMessage(client: Socket, data: MessageDto) {
    // 实现消息处理
  }
}
```

### 第二步：实现工作空间文件系统

```typescript
// src/workspace/workspace.service.ts
@Injectable()
export class WorkspaceService {
  private readonly root = path.join(process.cwd(), 'workspace');
  
  async onModuleInit() {
    // 确保工作空间根目录存在
    await fs.ensureDir(this.root);
    await fs.ensureDir(path.join(this.root, 'sessions'));
    await fs.ensureDir(path.join(this.root, 'archives'));
  }
  
  // 核心方法实现...
}
```

### 第三步：实现Config Hot-reload

```typescript
// src/config/config-watcher.service.ts
@Injectable()
export class ConfigWatcherService implements OnModuleInit {
  async onModuleInit() {
    // 启动文件监听器
    const watcher = chokidar.watch('config/**/*', { ... });
    watcher.on('change', this.handleConfigChange.bind(this));
  }
}
```

### 第四步：实现定时任务

```typescript
// src/tasks/scheduled-tasks.service.ts
@Injectable()
export class ScheduledTasksService {
  @Cron(CronExpression.EVERY_5_MINUTES)
  async healthCheck() { ... }
  
  @Cron(CronExpression.EVERY_HOUR)
  async summarizeMemories() { ... }
}
```

---

## 架构演进路线

### v1.0（MVP）

✅ 必需组件：
- Gateway（WebSocket）
- 3个Agent（Claude/Codex/Gemini）
- 文件系统工作空间
- Redis短期记忆
- PostgreSQL持久化
- Transcript日志

⏸️ 可选组件：
- Config Hot-reload
- Cron定时任务
- 向量检索（ChromaDB）

### v1.1（增强）

- ✅ Config Hot-reload
- ✅ Background Cron Jobs
- ✅ Agent健康监控
- ✅ 记忆摘要

### v2.0（生产级）

- ✅ ChromaDB向量检索
- ✅ 水平扩展支持
- ✅ Dashboard监控界面
- ✅ 高级权限管理
- ✅ 插件市场

---

## 总结与建议

### OpenClaw给我们的启示

| 设计决策 | OpenClaw的选择 | 为什么好 | Lobster采用 |
|---------|---------------|---------|------------|
| **单一Gateway** | Hub-and-Spoke | 简化状态管理 | ✅ 完全采用 |
| **文件系统存储** | Markdown + JSONL | 可审计、可搜索 | ✅ 完全采用 |
| **配置热重载** | Chokidar watcher | 开发效率高 | ✅ 完全采用 |
| **Localhost绑定** | 默认127.0.0.1 | 安全优先 | ✅ 采用 |
| **Session隔离** | 多Workspace | 上下文隔离 | ❌ 改为共享 |
| **多Channel** | WhatsApp/Telegram | 通用平台 | ❌ 专注Web |

### Lobster的差异化

| 特性 | OpenClaw | Lobster | 优势 |
|------|----------|---------|------|
| **交互模式** | 一对一 | 群聊 | 更自然的协作 |
| **Agent数量** | 一次一个 | 同时多个在线 | 并行处理 |
| **上下文** | 隔离 | 共享 | 无需重复 |
| **响应机制** | 路由规则 | 主动决策 | 更智能 |

### 实施建议

**优先级排序**：

🔴 **P0（必须）- 第1周实现**：
1. Gateway基础框架（NestJS + Socket.io）
2. 3个Agent Adapter（Claude/Codex/Gemini）
3. 文件系统工作空间
4. PostgreSQL基础存储

🟡 **P1（重要）- 第2周实现**：
5. Transcript日志系统（JSONL）
6. Redis短期记忆
7. Config热重载
8. Agent主动决策引擎

🟢 **P2（优化）- 第3-4周**：
9. Cron定时任务
10. 向量检索（ChromaDB）
11. 记忆摘要
12. Dashboard监控

⚪ **P3（未来）**：
13. 插件市场
14. 高级分析
15. 多租户支持

---

**结论**：OpenClaw的Hub-and-Spoke架构、文件系统工作空间、Config热重载等设计非常优秀，值得完全借鉴。同时，Lobster在多Agent协作、共享上下文方面有创新，两者结合能创造出更强大的系统。

---

**文档版本**: v1.0.0  
**最后更新**: 2026-02-18  
**参考资料**: OpenClaw Official Docs, Medium Articles
