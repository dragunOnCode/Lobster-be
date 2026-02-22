# Sprint 1 详细任务看板

> **Sprint周期**：第1-2周  
> **Sprint目标**：实现MVP，打通端到端流程  
> **版本**：v0.1.0  
> **日期**：2026-02-18

---

## 🎯 Sprint目标

### 核心目标

```
✅ 用户可以发送消息到聊天室
✅ Claude Agent可以接收并响应消息
✅ 消息保存到PostgreSQL数据库
✅ 代码文件保存到文件系统工作空间
✅ 基础的Transcript日志记录
```

### Demo场景

```
用户在前端输入: "Hello Claude"
           ↓
WebSocket推送到后端Gateway
           ↓
Gateway保存消息到数据库
           ↓
Gateway调用Claude Agent
           ↓
Claude生成响应: "Hello! 我是Claude，很高兴为您服务..."
           ↓
响应保存到数据库和文件系统
           ↓
推送到前端显示
```

---

## 📋 任务看板

### Backlog（待办）

```
┌────────────────────────────────────────────────────────┐
│                    BACKLOG                             │
├────────────────────────────────────────────────────────┤
│                                                        │
│ 🔴 P0.1: 项目初始化与环境搭建                          │
│ 🔴 P0.2: Gateway基础框架                               │
│ 🔴 P0.3: Claude Agent实现                              │
│ 🔴 P0.4: 数据库Schema                                  │
│ 🔴 P0.5: 文件系统工作空间                              │
│ 🔴 P0.6: 端到端集成                                    │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## Day 1-2: 项目初始化

### 🔴 任务1: NestJS项目初始化

**Story**: 作为开发者，我需要一个基础的NestJS项目，以便开始开发。

**子任务**：

```
□ 1.1 安装NestJS CLI
  命令: npm install -g @nestjs/cli
  验收: nest --version
  预计: 10分钟

□ 1.2 创建NestJS项目
  命令: cd backend && nest new . --package-manager npm --skip-git
  验收: 项目文件夹创建成功
  预计: 15分钟

□ 1.3 配置TypeScript
  文件: tsconfig.json
  配置: 
    - strict: true
    - esModuleInterop: true
    - skipLibCheck: true
  验收: 编译无错误
  预计: 15分钟

□ 1.4 配置ESLint和Prettier
  文件: .eslintrc.js, .prettierrc
  验收: npm run lint 通过
  预计: 20分钟

□ 1.5 创建.env.example
  内容: 所有环境变量模板
  验收: 文件创建成功
  预计: 15分钟
```

**代码清单**：

```bash
# 1. 安装CLI
npm install -g @nestjs/cli

# 2. 创建项目
cd d:/Project/Lobster/backend
nest new . --package-manager npm --skip-git

# 3. 安装核心依赖
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
npm install @nestjs/typeorm typeorm pg
npm install @nestjs/config
npm install ioredis
npm install class-validator class-transformer

# 4. 安装开发依赖
npm install -D @types/node
npm install -D prettier eslint
```

**验收标准**：
- ✅ `npm run start:dev` 可以启动
- ✅ 访问 http://localhost:3000 返回 "Hello World!"
- ✅ TypeScript编译无错误

---

### 🔴 任务2: Docker Compose环境

**Story**: 作为开发者，我需要本地开发环境，以便进行开发和测试。

**子任务**：

```
□ 2.1 创建docker-compose.yml
  位置: backend/docker/docker-compose.yml
  服务: postgres, redis, chromadb, minio
  预计: 30分钟

□ 2.2 配置PostgreSQL
  版本: pgvector/pgvector:pg16
  端口: 5432
  验收: 可以连接
  预计: 15分钟

□ 2.3 配置Redis
  版本: redis:7-alpine
  端口: 6379
  验收: redis-cli ping 返回 PONG
  预计: 10分钟

□ 2.4 启动所有服务
  命令: docker-compose up -d
  验收: 所有容器运行中
  预计: 15分钟

□ 2.5 测试连接
  PostgreSQL: psql连接测试
  Redis: redis-cli测试
  预计: 20分钟
```

**docker-compose.yml**：

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: lobster-postgres
    environment:
      POSTGRES_DB: lobster
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U admin"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: lobster-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  chromadb:
    image: chromadb/chroma:latest
    container_name: lobster-chromadb
    ports:
      - "8000:8000"
    volumes:
      - chroma_data:/chroma/chroma
    environment:
      - IS_PERSISTENT=TRUE

  minio:
    image: minio/minio:latest
    container_name: lobster-minio
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  redis_data:
  chroma_data:
  minio_data:
```

**验收标准**：
- ✅ `docker-compose ps` 显示所有服务健康
- ✅ PostgreSQL可连接
- ✅ Redis可连接

---

### 🔴 任务3: 项目目录结构

**Story**: 作为开发者，我需要清晰的项目结构，以便组织代码。

**子任务**：

```
□ 3.1 创建核心模块目录
  目录:
    - src/gateway/
    - src/agents/
    - src/database/
    - src/workspace/
    - src/memory/
    - src/chat/
    - src/common/
  预计: 15分钟

□ 3.2 创建配置目录
  目录: config/
  文件: agents.config.json
  预计: 10分钟

□ 3.3 创建工作空间根目录
  目录: workspace/sessions/
  预计: 5分钟

□ 3.4 生成NestJS模块骨架
  命令:
    - nest g module gateway
    - nest g module agents
    - nest g module database
    - nest g module workspace
  预计: 20分钟
```

**最终目录结构**：

```
backend/
├── src/
│   ├── gateway/              # Gateway模块
│   │   ├── gateway.module.ts
│   │   ├── chat.gateway.ts
│   │   └── session.manager.ts
│   ├── agents/               # Agent模块
│   │   ├── agents.module.ts
│   │   ├── interfaces/
│   │   │   └── llm-adapter.interface.ts
│   │   ├── adapters/
│   │   │   ├── claude.adapter.ts
│   │   │   ├── codex.adapter.ts
│   │   │   └── gemini.adapter.ts
│   │   └── services/
│   │       └── agent-config.service.ts
│   ├── database/             # 数据库模块
│   │   ├── database.module.ts
│   │   └── entities/
│   │       ├── user.entity.ts
│   │       ├── session.entity.ts
│   │       └── message.entity.ts
│   ├── workspace/            # 工作空间模块
│   │   ├── workspace.module.ts
│   │   ├── workspace.service.ts
│   │   └── transcript.service.ts
│   ├── memory/               # 记忆模块
│   │   └── memory.module.ts
│   ├── chat/                 # 聊天模块
│   │   └── chat.module.ts
│   ├── common/               # 公共模块
│   │   ├── decorators/
│   │   ├── filters/
│   │   └── interceptors/
│   ├── app.module.ts
│   └── main.ts
├── config/                   # 配置文件
│   ├── agents.config.json
│   └── prompts/
├── workspace/                # 工作空间
│   └── sessions/
├── docker/
│   └── docker-compose.yml
├── test/
├── .env.example
├── package.json
└── tsconfig.json
```

**验收标准**：
- ✅ 所有目录创建完成
- ✅ 模块骨架生成成功
- ✅ 目录结构清晰合理

---

## Day 3-4: Gateway实现

### 🔴 任务4: WebSocket Gateway

**Story**: 作为用户，我需要通过WebSocket连接到聊天室。

**子任务**：

```
□ 4.1 ChatGateway创建
  文件: src/gateway/chat.gateway.ts
  内容: 
    - @WebSocketGateway装饰器
    - handleConnection
    - handleDisconnect
    - handleMessage事件
  预计: 2小时

□ 4.2 SessionManager实现
  文件: src/gateway/session.manager.ts
  职责:
    - 管理活跃连接
    - 会话成员管理
    - 消息广播
  预计: 3小时

□ 4.3 MessageRouter实现
  文件: src/gateway/message.router.ts
  职责:
    - 消息路由逻辑
    - @提及解析（基础版）
  预计: 2小时

□ 4.4 单元测试
  测试文件: chat.gateway.spec.ts
  测试场景:
    - 连接建立
    - 消息发送接收
  预计: 2小时
```

**详细实现代码**：

```typescript
// src/gateway/chat.gateway.ts
import { 
  WebSocketGateway, 
  WebSocketServer, 
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ 
  namespace: '/chat',
  cors: {
    origin: '*', // 开发环境，生产需配置具体域名
    credentials: true
  }
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly chatService: ChatService
  ) {}

  /**
   * 客户端连接时触发
   */
  async handleConnection(client: Socket) {
    const sessionId = client.handshake.query.sessionId as string;
    const userId = client.handshake.query.userId as string;

    if (!sessionId || !userId) {
      client.disconnect();
      return;
    }

    // 加入会话房间
    client.join(`session:${sessionId}`);
    await this.sessionManager.addClient(sessionId, client);

    console.log(`✅ 客户端连接: ${client.id} (User: ${userId}, Session: ${sessionId})`);

    // 发送历史消息
    const history = await this.chatService.getRecentMessages(sessionId, 20);
    client.emit('chat:history', history);

    // 通知其他成员
    this.server.to(`session:${sessionId}`).emit('user:joined', {
      userId,
      timestamp: new Date()
    });
  }

  /**
   * 客户端断开时触发
   */
  handleDisconnect(client: Socket) {
    const sessionId = client.handshake.query.sessionId as string;
    this.sessionManager.removeClient(sessionId, client.id);

    console.log(`❌ 客户端断开: ${client.id}`);
  }

  /**
   * 接收用户消息
   */
  @SubscribeMessage('message:send')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { content: string; sessionId: string }
  ) {
    const userId = client.handshake.query.userId as string;

    // 1. 保存消息
    const message = await this.chatService.saveMessage({
      sessionId: data.sessionId,
      userId,
      role: 'user',
      content: data.content
    });

    // 2. 广播给房间所有成员
    this.server.to(`session:${data.sessionId}`).emit('message:received', message);

    // 3. 触发Agent响应（暂时简化，只调用Claude）
    await this.handleAgentResponse(data.sessionId, message);
  }

  /**
   * Agent响应处理（MVP简化版）
   */
  private async handleAgentResponse(sessionId: string, message: Message) {
    // TODO: 在Sprint 2实现完整的决策引擎
    // 暂时直接调用Claude
    
    const claudeAgent = await this.agentService.getAgent('claude-001');
    
    this.server.to(`session:${sessionId}`).emit('agent:start', {
      agentId: claudeAgent.id,
      agentName: claudeAgent.name,
      timestamp: new Date()
    });

    const response = await claudeAgent.generate(message.content, {
      sessionId
    });

    const agentMessage = await this.chatService.saveMessage({
      sessionId,
      agentId: claudeAgent.id,
      role: 'assistant',
      content: response.content
    });

    this.server.to(`session:${sessionId}`).emit('message:received', agentMessage);
  }
}
```

**验收标准**：
- ✅ WebSocket连接成功
- ✅ 可以加入会话
- ✅ 可以发送消息
- ✅ 可以接收广播消息

---

### 🔴 任务5: SessionManager

```typescript
// src/gateway/session.manager.ts
@Injectable()
export class SessionManager {
  // sessionId -> Set<clientId>
  private sessions: Map<string, Set<string>> = new Map();
  
  // clientId -> Socket
  private clients: Map<string, Socket> = new Map();

  /**
   * 添加客户端到会话
   */
  async addClient(sessionId: string, client: Socket): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Set());
    }

    this.sessions.get(sessionId).add(client.id);
    this.clients.set(client.id, client);

    console.log(`📌 会话 ${sessionId} 当前成员: ${this.sessions.get(sessionId).size}`);
  }

  /**
   * 移除客户端
   */
  removeClient(sessionId: string, clientId: string): void {
    this.sessions.get(sessionId)?.delete(clientId);
    this.clients.delete(clientId);
  }

  /**
   * 获取会话所有客户端
   */
  getSessionClients(sessionId: string): Socket[] {
    const clientIds = this.sessions.get(sessionId) || new Set();
    return Array.from(clientIds)
      .map(id => this.clients.get(id))
      .filter(Boolean) as Socket[];
  }

  /**
   * 广播消息到会话
   */
  broadcastToSession(sessionId: string, event: string, data: any): void {
    const clients = this.getSessionClients(sessionId);
    clients.forEach(client => {
      client.emit(event, data);
    });
  }
}
```

---

## Day 5-6: Agent实现

### 🔴 任务6: ILLMAdapter接口

```typescript
// src/agents/interfaces/llm-adapter.interface.ts
export interface ILLMAdapter {
  // 基本信息
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly type: string;
  readonly role: string;
  readonly capabilities: string[];
  readonly callType: 'cli' | 'http';

  // 核心方法
  generate(prompt: string, context: AgentContext): Promise<AgentResponse>;
  streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string>;
  shouldRespond(message: Message, context: AgentContext): Promise<DecisionResult>;
  healthCheck(): Promise<boolean>;
  getStatus(): AgentStatus;
}

// 上下文类型
export interface AgentContext {
  sessionId: string;
  userId?: string;
  conversationHistory?: Message[];
  sharedMemory?: SharedMemory;
  workspaceChange?: WorkspaceChangeEvent;
}

// 响应类型
export interface AgentResponse {
  content: string;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  metadata?: Record<string, any>;
  timestamp: Date;
}

// 决策结果
export interface DecisionResult {
  should: boolean;
  reason?: string;
  priority?: 'high' | 'medium' | 'low';
}

// Agent状态
export enum AgentStatus {
  ONLINE = 'online',
  BUSY = 'busy',
  OFFLINE = 'offline',
  ERROR = 'error'
}
```

---

### 🔴 任务7: Claude Adapter完整实现

```typescript
// src/agents/adapters/claude.adapter.ts
import { Injectable, HttpService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ILLMAdapter, AgentContext, AgentResponse, DecisionResult, AgentStatus } from '../interfaces';

@Injectable()
export class ClaudeAdapter implements ILLMAdapter {
  readonly id = 'claude-001';
  readonly name = 'Claude';
  readonly model = 'anthropic/claude-3-sonnet';
  readonly type = 'claude';
  readonly role = '架构设计与编码实现';
  readonly capabilities = ['架构设计', '代码生成', '技术选型', '重构'];
  readonly callType = 'http';

  private status: AgentStatus = AgentStatus.OFFLINE;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {}

  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    const apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    const apiKey = this.configService.get('OPENROUTER_API_KEY');

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    this.status = AgentStatus.BUSY;

    try {
      const response = await this.httpService.post(apiUrl, {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: this.buildSystemPrompt(context)
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 4000
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://lobster.com',
          'X-Title': 'Lobster Coding Assistant'
        },
        timeout: 60000
      }).toPromise();

      this.status = AgentStatus.ONLINE;

      return {
        content: response.data.choices[0].message.content,
        tokenUsage: {
          prompt: response.data.usage.prompt_tokens,
          completion: response.data.usage.completion_tokens,
          total: response.data.usage.total_tokens
        },
        timestamp: new Date()
      };
    } catch (error) {
      this.status = AgentStatus.ERROR;
      throw error;
    }
  }

  async *streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string> {
    // Sprint 2实现
    throw new Error('Not implemented in Sprint 1');
  }

  async shouldRespond(message: Message, context: AgentContext): Promise<DecisionResult> {
    // Sprint 2实现完整逻辑
    // Sprint 1简化版：总是响应
    return {
      should: true,
      reason: 'MVP版本，默认响应所有消息',
      priority: 'high'
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testResponse = await this.generate('test', { sessionId: 'health-check' });
      return !!testResponse.content;
    } catch {
      return false;
    }
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  private buildSystemPrompt(context: AgentContext): string {
    return `你是Claude，一个专业的软件架构师和全栈开发工程师。
你的职责是：
1. 设计系统架构
2. 编写高质量代码
3. 提供技术选型建议
4. 进行代码重构

请用专业、严谨的方式回答问题。`;
  }

  private escapeShell(str: string): string {
    return str.replace(/"/g, '\\"');
  }
}
```

**验收标准**：
- ✅ Claude API调用成功
- ✅ 返回正确格式的响应
- ✅ 健康检查通过
- ✅ 错误处理完善

---

## Day 7-8: 数据库实现

### 🔴 任务8: 数据库模块

**数据库迁移脚本**：

```typescript
// src/database/migrations/1708272000000-InitialSchema.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1708272000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 创建users表
    await queryRunner.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 创建sessions表
    await queryRunner.query(`
      CREATE TABLE sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(200) NOT NULL,
        owner_id UUID REFERENCES users(id),
        participants TEXT[] DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message_at TIMESTAMP
      );
    `);

    // 创建messages表
    await queryRunner.query(`
      CREATE TABLE messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        agent_id VARCHAR(50),
        agent_name VARCHAR(50),
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        mentioned_agents TEXT[] DEFAULT '{}',
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 创建索引
    await queryRunner.query(`
      CREATE INDEX idx_messages_session_id ON messages(session_id);
      CREATE INDEX idx_messages_created_at ON messages(created_at);
      CREATE INDEX idx_sessions_owner_id ON sessions(owner_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE messages;`);
    await queryRunner.query(`DROP TABLE sessions;`);
    await queryRunner.query(`DROP TABLE users;`);
  }
}
```

**验收标准**：
- ✅ 迁移脚本可执行
- ✅ 所有表创建成功
- ✅ 索引创建成功
- ✅ 可以执行CRUD操作

---

## Day 9-10: 工作空间实现

### 🔴 任务9: 文件系统工作空间

**完整实现**：

```typescript
// src/workspace/workspace.service.ts
import { Injectable } from '@nestjs/common';
import * as fs from 'fs-extra';
import * as path from 'path';

@Injectable()
export class WorkspaceService {
  private readonly workspaceRoot = path.join(process.cwd(), 'workspace', 'sessions');

  async onModuleInit() {
    await fs.ensureDir(this.workspaceRoot);
    console.log(`✅ 工作空间根目录: ${this.workspaceRoot}`);
  }

  /**
   * 初始化会话工作空间
   */
  async initializeSession(sessionId: string): Promise<void> {
    const sessionPath = this.getSessionPath(sessionId);

    // 创建目录结构
    await fs.ensureDir(path.join(sessionPath, 'code'));
    await fs.ensureDir(path.join(sessionPath, 'docs'));

    // 创建metadata.json
    await fs.writeFile(
      path.join(sessionPath, 'metadata.json'),
      JSON.stringify({
        sessionId,
        createdAt: new Date().toISOString(),
        version: '1.0.0',
        agents: [],
        fileCount: 0
      }, null, 2)
    );

    // 创建空的transcripts.jsonl
    await fs.writeFile(
      path.join(sessionPath, 'transcripts.jsonl'),
      ''
    );

    // 记录创建事件
    await this.appendTranscript(sessionId, {
      type: 'session_created',
      sessionId,
      timestamp: new Date().toISOString()
    });

    console.log(`✅ 会话工作空间初始化完成: ${sessionId}`);
  }

  /**
   * 保存代码文件
   */
  async saveCodeFile(
    sessionId: string,
    filePath: string,
    content: string,
    author: string
  ): Promise<void> {
    const fullPath = path.join(
      this.getSessionPath(sessionId),
      'code',
      filePath
    );

    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, 'utf-8');

    // 记录到transcript
    await this.appendTranscript(sessionId, {
      type: 'file_created',
      path: filePath,
      author,
      language: this.detectLanguage(filePath),
      linesOfCode: content.split('\n').length,
      timestamp: new Date().toISOString()
    });

    console.log(`💾 文件已保存: ${filePath}`);
  }

  /**
   * 追加到Transcript日志
   */
  async appendTranscript(sessionId: string, event: any): Promise<void> {
    const transcriptPath = path.join(
      this.getSessionPath(sessionId),
      'transcripts.jsonl'
    );

    const entry = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString()
    };

    await fs.appendFile(
      transcriptPath,
      JSON.stringify(entry) + '\n',
      'utf-8'
    );
  }

  /**
   * 读取Transcript日志
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

  private getSessionPath(sessionId: string): string {
    return path.join(this.workspaceRoot, sessionId);
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath);
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.js': 'javascript',
      '.vue': 'vue',
      '.py': 'python',
      '.java': 'java',
      '.md': 'markdown'
    };
    return langMap[ext] || 'text';
  }
}
```

**验收标准**：
- ✅ 会话创建时自动初始化目录
- ✅ 可以保存代码文件
- ✅ Transcript正确记录所有事件
- ✅ 可以读取历史记录

---

## Day 11-12: 端到端集成

### 🔴 任务10: 完整流程打通

**集成测试场景**：

```typescript
// test/e2e/chat.e2e-spec.ts
describe('Chat E2E Test', () => {
  let app: INestApplication;
  let socket: Socket;

  beforeAll(async () => {
    // 启动应用
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(3000);

    // 连接WebSocket
    socket = io('http://localhost:3000/chat', {
      query: {
        sessionId: 'test-session-001',
        userId: 'test-user-001'
      }
    });
  });

  it('完整流程：发送消息 → Agent响应', (done) => {
    const testMessage = 'Hello Claude';

    // 监听Agent响应
    socket.on('message:received', (message) => {
      if (message.role === 'assistant') {
        expect(message.content).toBeDefined();
        expect(message.agentId).toBe('claude-001');
        done();
      }
    });

    // 发送消息
    socket.emit('message:send', {
      content: testMessage,
      sessionId: 'test-session-001'
    });
  });

  afterAll(async () => {
    socket.disconnect();
    await app.close();
  });
});
```

**验收标准**：
- ✅ E2E测试全部通过
- ✅ 消息可以保存到数据库
- ✅ 文件系统正确记录
- ✅ Transcript日志完整

---

## Sprint 1 验收标准

### 功能验收

```
✅ 核心功能
  □ 用户可以连接WebSocket
  □ 用户可以发送消息
  □ Claude可以接收并响应
  □ 消息保存到PostgreSQL
  □ 文件保存到workspace/
  □ Transcript记录所有操作

✅ 非功能
  □ 响应时间 < 5秒
  □ 无内存泄漏
  □ 日志清晰可读
  □ 错误处理健壮
```

### 技术验收

```
✅ 代码质量
  □ ESLint检查通过
  □ TypeScript编译无错误
  □ 单元测试覆盖率 > 60%

✅ 文档完善
  □ README更新
  □ API文档生成
  □ 部署文档完成
```

---

## Sprint 1 交付物

### 代码交付

```
Git Tag: sprint-1-mvp
Version: v0.1.0
Branch: main

交付内容:
✅ 完整的NestJS后端项目
✅ Gateway模块（WebSocket）
✅ Agent模块（Claude实现）
✅ Database模块（基础Schema）
✅ Workspace模块（文件系统）
✅ Docker Compose配置
✅ 单元测试
✅ E2E测试
```

### 文档交付

```
✅ README.md (使用说明)
✅ API.md (API文档)
✅ DEPLOYMENT.md (部署文档)
✅ CHANGELOG.md (变更日志)
```

---

## Sprint 1 回顾模板

### 进展回顾

```
✅ 完成的任务: X/Y
⏸️ 未完成的任务: Z/Y
🐛 发现的问题: N个
💡 改进建议: M个
```

### 团队反思

```
做得好的地方:
-
-

需要改进的地方:
-
-

下个Sprint行动项:
-
-
```

---

## 下一步：Sprint 2

Sprint 1完成后，立即进入Sprint 2：

```
Sprint 2 重点:
✅ 实现Codex和Gemini Adapter
✅ Agent决策引擎
✅ @提及功能
✅ 流式响应
✅ Redis记忆层
✅ Config热重载
```

---

**准备好了吗？让我们开始Sprint 1的开发！** 🚀

---

**文档版本**: v1.0.0  
**最后更新**: 2026-02-18  
**Sprint状态**: 📝 待开始
