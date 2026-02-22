# Sprint 2 详细任务看板

> **Sprint周期**：第3-4周  
> **Sprint目标**：实现群聊式多Agent协作  
> **版本**：v0.2.0  
> **日期**：2026-02-20  
> **前置条件**：Sprint 1（v0.1.0）已完成

---

## Sprint 1 回顾

### 已完成

| 模块 | 状态 | 说明 |
|------|------|------|
| NestJS项目骨架 | ✅ 完成 | 模块化结构清晰 |
| Gateway (WebSocket) | ✅ 完成 | chat.gateway / session.manager / message.router |
| Claude Adapter (HTTP) | ✅ 完成 | OpenRouter API，generate / healthCheck |
| Database | ✅ 完成 | TypeORM + PostgreSQL，User/Session/Message Entity，迁移脚本 |
| Workspace | ✅ 完成 | 文件系统目录管理，Transcript JSONL |
| Chat Service | ✅ 完成 | 消息保存查询，内存+DB双写 |
| @Mention解析 | ✅ 完成 | message.router 正则提取 |

### 待完善（Sprint 2 接手）

| 项目 | 当前状态 | Sprint 2 目标 |
|------|---------|--------------|
| Codex / Gemini Adapter | 未实现 | 完整实现 CLI 调用 |
| AgentService | 仅硬编码 claude-001 | 支持多Agent动态注册 |
| shouldRespond() | 恒返回 true | 完整决策引擎 |
| streamGenerate() | 抛出 NotImplemented | Claude 流式响应 |
| Memory 模块 | 空壳 | Redis 短期记忆 + 共享记忆 |
| Config 热重载 | 不存在 | Chokidar 监听 agents.config.json |
| handleAgentResponse() | 仅调用 claude-001 | 决策引擎驱动多Agent并行 |

---

## Sprint 目标

```
✅ 3个Agent全部可用（Claude + Codex + Gemini）
✅ Agent主动决策引擎（shouldRespond 规则化）
✅ @提及 → 指定Agent优先响应
✅ Claude 流式响应（SSE → WebSocket 推送）
✅ Redis 短期记忆 + 共享记忆
✅ agents.config.json 热重载
```

### Demo场景

```
用户: @Claude 帮我实现一个登录接口
           ↓
Gateway 解析 @Claude → mentionedAgents: ['claude']
           ↓
决策引擎并行询问 3 个 Agent：
  Claude: should=true (被@提及, priority=10)
  Codex:  should=false
  Gemini: should=false
           ↓
Claude 流式生成 → agent:stream 逐块推送前端
           ↓
用户看到打字机效果的实时输出
           ↓
Codex 检测到新代码 → should=true (工作空间变更)
Codex: "我审查了Claude生成的代码，建议添加参数校验..."
           ↓
所有对话保存到 DB + Transcript + Redis短期记忆
```

---

## Day 1-2: Codex 与 Gemini Adapter

### 任务 7.1: CLI 调用基础设施

**目标**：封装 `child_process.execFile` 为可复用的 CLI Runner。

**文件**：`src/agents/services/cli-runner.service.ts`

**子任务**：

```
□ 封装 execFile 为 Promise
  - 标准输出 / 标准错误 分离
  - 超时控制（configurable timeout）
  - 退出码检查
  预计: 2小时

□ 错误处理
  - 超时 → TimeoutError
  - 非零退出码 → CliExitError
  - 进程 spawn 失败 → CliNotFoundError
  预计: 1小时

□ 单元测试
  - 模拟正常输出
  - 模拟超时
  - 模拟非零退出
  预计: 1小时
```

**实现要点**：

```typescript
// src/agents/services/cli-runner.service.ts
@Injectable()
export class CliRunnerService {
  async run(opts: {
    command: string;
    args: string[];
    timeout?: number;
    cwd?: string;
    input?: string;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}
```

**验收标准**：
- ✅ 可执行任意 CLI 命令并获取输出
- ✅ 超时自动 kill 子进程
- ✅ 错误类型明确

---

### 任务 7.2: Codex Adapter

**文件**：`src/agents/adapters/codex.adapter.ts`

**子任务**：

```
□ 实现 CodexAdapter
  - 通过 CliRunnerService 调用 codex-cli
  - generate() 封装 CLI 输入/输出
  - shouldRespond() 关键词+@提及+代码变更
  预计: 3小时

□ 配置化
  - 从 ConfigService 读取 CODEX_CLI_PATH / CODEX_TIMEOUT_MS
  预计: 30分钟

□ 测试
  - 模拟 CliRunnerService 返回
  - 测试 shouldRespond 各分支
  预计: 1.5小时
```

**shouldRespond 规则**：

```
优先级从高到低：
1. @Codex 被直接提及            → should=true, priority=high
2. 消息含关键词（审查/检查/测试/bug/问题/安全） → should=true, priority=medium
3. 工作空间出现新文件或代码变更  → should=true, priority=medium
4. 其他                         → should=false
```

**验收标准**：
- ✅ `generate()` 可调用 Codex CLI 并返回结构化响应
- ✅ `shouldRespond()` 按规则正确决策
- ✅ CLI 不存在时 `healthCheck()` 返回 false

---

### 任务 7.3: Gemini Adapter

**文件**：`src/agents/adapters/gemini.adapter.ts`

**子任务**：

```
□ 实现 GeminiAdapter
  - 通过 CliRunnerService 调用 gemini CLI
  - generate() 封装 CLI 输入/输出
  - shouldRespond() 关键词+@提及
  预计: 3小时

□ 配置化
  - 从 ConfigService 读取 GEMINI_CLI_PATH / GEMINI_TIMEOUT_MS
  预计: 30分钟

□ 测试
  预计: 1.5小时
```

**shouldRespond 规则**：

```
1. @Gemini 被直接提及            → should=true, priority=high
2. 消息含关键词（设计/UI/UX/界面/视觉/交互/创意/美化） → should=true, priority=medium
3. 其他                         → should=false
```

**验收标准**：
- ✅ `generate()` 可调用 Gemini CLI 并返回结构化响应
- ✅ `shouldRespond()` 按规则正确决策

---

### 任务 7.4: Agent 注册与工厂

**目标**：重构 `AgentService`，从硬编码单 Agent 升级为动态多 Agent 注册表。

**文件**：`src/agents/services/agent.service.ts`，`src/agents/agents.module.ts`

**子任务**：

```
□ 重构 AgentService
  - 内部维护 Map<agentId, ILLMAdapter>
  - registerAgent() / unregisterAgent()
  - getAgent() / getAllAgents() / getAgentByName()
  预计: 2小时

□ 模块注册
  - AgentsModule 中注册 ClaudeAdapter / CodexAdapter / GeminiAdapter
  - OnModuleInit 时自动注册到 AgentService
  预计: 1小时

□ 更新 adapters/index.ts 导出
  预计: 15分钟

□ 测试
  - 注册 / 获取 / 不存在时抛错
  预计: 1小时
```

**验收标准**：
- ✅ `getAllAgents()` 返回 3 个 Adapter
- ✅ `getAgent('codex-001')` 返回 CodexAdapter
- ✅ `getAgentByName('Gemini')` 返回 GeminiAdapter

---

## Day 3-4: Agent 决策引擎

### 任务 8.1: AgentDecisionEngine

**文件**：`src/agents/services/decision-engine.service.ts`

**子任务**：

```
□ DecisionEngine 核心逻辑
  - decideResponders(message, agents, context) → AgentDecision[]
  - 并行调用所有 Agent 的 shouldRespond()
  - 超时保护（单 Agent 决策 ≤ 3s）
  预计: 3小时

□ 优先级计算
  - @提及 → priority 10
  - 关键词命中 → priority 5
  - 工作空间变更 → priority 5
  预计: 1小时

□ 冲突处理
  - 多个 Agent 同时 should=true 时全部响应
  - 按 priority 排序依次响应
  预计: 1小时

□ 测试
  - 无@提及，仅关键词 → 正确Agent响应
  - @Claude → 仅Claude响应
  - @Claude @Gemini → 两个都响应
  - 无人 should → 空数组
  预计: 2小时
```

**接口定义**：

```typescript
interface AgentDecision {
  agent: ILLMAdapter;
  should: boolean;
  reason: string;
  priority: number;
}
```

**验收标准**：
- ✅ 并行决策，任意 Agent 超时不阻塞其他
- ✅ 优先级排序正确
- ✅ 100% 分支覆盖

---

### 任务 8.2: 重构 Gateway 消息处理

**目标**：将 `handleAgentResponse()` 从硬编码 claude-001 改为决策引擎驱动。

**文件**：`src/gateway/chat.gateway.ts`

**子任务**：

```
□ 注入 DecisionEngine
  预计: 15分钟

□ 重写 handleAgentResponse()
  - 调用 decisionEngine.decideResponders()
  - 遍历决定响应的 Agent，依次生成
  - 广播 agent:thinking / agent:skip 事件
  预计: 3小时

□ 新增 WebSocket 事件
  - agent:thinking  — Agent正在思考
  - agent:response  — Agent完成响应
  - agent:skip      — Agent决定不响应（调试用，可选）
  预计: 1小时

□ 测试
  预计: 1.5小时
```

**新消息流程**：

```
message:send
  → messageRouter.route() 解析 @mention
  → chatService.saveMessage() 保存用户消息
  → broadcastToSession('message:received')
  → decisionEngine.decideResponders()
  → 对每个 should=true 的 Agent:
      → broadcastToSession('agent:thinking', { agentId, agentName })
      → agent.generate() 或 agent.streamGenerate()
      → chatService.saveMessage() 保存 Agent 响应
      → broadcastToSession('message:received')
```

**验收标准**：
- ✅ 用户发消息后，多个 Agent 可以依次响应
- ✅ 前端收到 agent:thinking 表明哪个 Agent 在思考
- ✅ @提及只触发被提及的 Agent

---

## Day 5-6: 流式响应

### 任务 9.1: Claude streamGenerate 实现

**文件**：`src/agents/adapters/claude.adapter.ts`

**子任务**：

```
□ 实现 streamGenerate()
  - 使用 axios 的 responseType: 'stream'
  - 解析 SSE data: 行，提取 delta.content
  - yield 每个增量块
  预计: 3小时

□ 错误处理
  - 流中断恢复
  - 超时处理
  预计: 1小时

□ 测试
  - mock SSE 流，验证 yield 顺序
  预计: 1.5小时
```

**实现要点**：

```typescript
async *streamGenerate(prompt: string, context: AgentContext): AsyncGenerator<string> {
  const response = await firstValueFrom(
    this.httpService.post(apiUrl, {
      model: this.model,
      messages: [...],
      stream: true,
    }, {
      responseType: 'stream',
      timeout: timeoutMs,
    }),
  );

  for await (const chunk of response.data) {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        const json = JSON.parse(line.slice(6));
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  }
}
```

---

### 任务 9.2: Gateway 流式推送

**文件**：`src/gateway/chat.gateway.ts`

**子任务**：

```
□ 新增流式分发逻辑
  - 判断 Agent 是否支持 stream（callType === 'http' 的才支持）
  - 支持流式 → streamGenerate + 逐块 emit('agent:stream')
  - 不支持流式 → generate + 一次性 emit('message:received')
  预计: 3小时

□ 新增 WebSocket 事件
  - agent:stream  { agentId, agentName, sessionId, delta, timestamp }
  - agent:stream:end  { agentId, sessionId, fullContent, timestamp }
  预计: 1小时

□ 节流控制
  - 合并 50ms 内的多个 delta，减少 emit 频率
  预计: 1小时

□ 测试
  预计: 1.5小时
```

**验收标准**：
- ✅ Claude 响应逐字推送到前端
- ✅ 流结束后发送完整内容用于持久化
- ✅ Codex/Gemini（CLI）仍然走一次性返回

---

## Day 7-8: Redis 记忆层

### 任务 10.1: Redis 模块

**文件**：`src/memory/memory.module.ts`，`src/memory/redis.provider.ts`

**子任务**：

```
□ 创建 Redis Provider
  - 使用 ioredis 连接
  - 从 ConfigService 读取 REDIS_HOST / REDIS_PORT / REDIS_PASSWORD
  - 导出 REDIS_CLIENT token
  预计: 1.5小时

□ MemoryModule 注册 Provider
  - 导出供其他模块使用
  预计: 30分钟

□ 连接测试
  - ping/pong 验证
  - 在 AppModule 启动时检测连接
  预计: 1小时
```

---

### 任务 10.2: ShortTermMemoryService

**文件**：`src/memory/services/short-term-memory.service.ts`

**子任务**：

```
□ 核心方法
  - save(sessionId, messages) — 缓存最近 N 条消息，TTL 5分钟
  - get(sessionId) → Message[]
  - append(sessionId, message) — 追加并截断
  预计: 2小时

□ 集成到 ChatService
  - saveMessage 后同步写入 Redis
  - getRecentMessages 优先从 Redis 读取
  预计: 1.5小时

□ 测试
  预计: 1小时
```

**验收标准**：
- ✅ 连续发送 25 条消息，Redis 中只保留最新 20 条
- ✅ 5分钟无活动后 key 自动过期
- ✅ Redis 不可用时降级到 DB 查询

---

### 任务 10.3: SharedMemoryService

**文件**：`src/memory/services/shared-memory.service.ts`

**子任务**：

```
□ 核心方法
  - setWorkspaceState(sessionId, state) — 缓存工作空间当前状态
  - getWorkspaceState(sessionId) → WorkspaceState
  - setDecision(sessionId, agentId, decision) — 缓存 Agent 最近决策
  预计: 2小时

□ 集成到 AgentContext
  - generate() 调用前从 SharedMemory 加载工作空间状态
  - 注入 conversationHistory (来自 ShortTermMemory)
  预计: 1.5小时

□ 测试
  预计: 1小时
```

---

### 任务 10.4: Redis Pub/Sub（可选）

**文件**：`src/memory/services/event-bus.service.ts`

**子任务**：

```
□ 发布者
  - publish('workspace:change', { sessionId, changeType, filePath })
  预计: 1小时

□ 订阅者
  - Agent 订阅 workspace:change
  - 收到变更后触发 shouldRespond 判断
  预计: 2小时

□ 测试
  预计: 1小时
```

**说明**：此任务为 P1+，如时间不足可推迟到 Sprint 3。

---

## Day 9-10: Config 热重载

### 任务 11.1: ConfigWatcherService

**文件**：`src/config/config-watcher.service.ts`，`src/config/config.module.ts`

**子任务**：

```
□ 安装 chokidar
  - npm install chokidar
  预计: 10分钟

□ 实现 ConfigWatcherService
  - OnModuleInit 时启动 chokidar 监听 config/ 目录
  - 文件变更 → 等待写入稳定（500ms debounce）
  - 触发 reload
  预计: 2小时

□ agents.config.json 重载
  - 读取新配置 → 校验合法性
  - 调用 AgentService 注册/注销 Agent
  - 广播 system:notification 到所有客户端
  预计: 2小时

□ 错误处理
  - 配置文件格式非法 → 拒绝重载，保持旧配置
  - 日志记录
  预计: 1小时

□ 测试
  - 修改 agents.config.json → 验证 AgentService 更新
  - 写入非法 JSON → 验证旧配置不变
  预计: 1.5小时
```

**验收标准**：
- ✅ 修改 agents.config.json 后无需重启，Agent 列表自动更新
- ✅ 非法配置不会导致崩溃
- ✅ 前端收到 `system:notification` 通知

---

### 任务 11.2: AgentConfigService 重构

**文件**：`src/agents/services/agent-config.service.ts`

**子任务**：

```
□ 从 agents.config.json 加载完整配置
  - 读取文件
  - 解析为 AgentConfig[]
  - 根据 type 创建对应 Adapter 实例
  预计: 2小时

□ reload() 方法
  - 被 ConfigWatcherService 调用
  - 对比新旧配置 diff
  - 新增 Agent → registerAgent
  - 移除 Agent → unregisterAgent
  - 修改 Agent → 重新创建实例
  预计: 2小时

□ 测试
  预计: 1小时
```

---

## Day 11-12: 集成测试与收尾

### 任务 12.1: 端到端集成测试

**文件**：`test/sprint2.e2e-spec.ts`

**子任务**：

```
□ 测试场景1: 多Agent响应
  - 发送包含架构关键词的消息
  - 验证 Claude 响应（关键词命中）
  预计: 1.5小时

□ 测试场景2: @提及
  - 发送 "@Codex 审查代码"
  - 验证仅 Codex 响应
  预计: 1.5小时

□ 测试场景3: 流式响应
  - 发送消息触发 Claude
  - 验证收到多个 agent:stream 事件
  - 验证最后收到 agent:stream:end
  预计: 2小时

□ 测试场景4: Redis 记忆
  - 发送多条消息
  - 验证 Redis 中存在短期记忆
  - 验证 Agent 收到 conversationHistory
  预计: 1.5小时
```

---

### 任务 12.2: Bug 修复与代码清理

```
□ 修复集成测试中发现的问题
  预计: 3小时

□ 代码审查 & 清理
  - 移除 TODO 注释
  - 统一错误处理
  - 补充缺失的类型定义
  预计: 2小时

□ 更新文档
  - API 文档更新
  - WebSocket 事件文档
  - CHANGELOG
  预计: 1.5小时
```

---

### 任务 12.3: Sprint 1 遗留修复

```
□ main.ts 添加 void 前缀消除 lint 警告
  预计: 5分钟

□ Common 模块基础实现
  - 全局异常过滤器 HttpExceptionFilter
  - 日志拦截器 LoggingInterceptor
  预计: 2小时

□ 健康检查端点
  - GET /api/health → { status, uptime, agents, redis, database }
  预计: 1小时
```

---

## Sprint 2 验收标准

### 功能验收

```
✅ 核心功能
  □ @Claude 发消息 → Claude 响应
  □ @Codex 发消息 → Codex 响应
  □ @Gemini 发消息 → Gemini 响应
  □ 不带@的消息 → 决策引擎决定谁响应
  □ Claude 响应为流式，逐字推送
  □ Codex/Gemini 响应为一次性返回
  □ Redis 缓存最近 20 条消息
  □ 修改 agents.config.json 后自动重载

✅ WebSocket 事件
  □ agent:thinking  — Agent开始思考
  □ agent:stream    — Claude流式增量
  □ agent:stream:end — Claude流式结束
  □ agent:response  — Agent一次性响应
  □ agent:skip      — Agent决定不响应
  □ system:notification — 系统通知（配置重载等）
```

### 技术验收

```
✅ 代码质量
  □ npm run lint 零错误
  □ npm run build 成功
  □ 单元测试覆盖率 ≥ 70%
  □ E2E 核心场景全覆盖

✅ 性能
  □ Agent 决策延迟 < 3s
  □ Claude 流式首字节 < 2s
  □ Redis 读写 < 10ms
```

---

## Sprint 2 交付物

```
版本: v0.2.0
Tag:  sprint-2-core

交付内容:
✅ 3 个 Agent Adapter (Claude / Codex / Gemini)
✅ Agent 决策引擎
✅ Claude 流式响应
✅ Redis 短期记忆 + 共享记忆
✅ Config 热重载
✅ 全局异常过滤器
✅ 健康检查端点
✅ 完整的 E2E 测试
✅ 更新后的 API 文档
```

---

## 新增依赖

```bash
# Sprint 2 新增依赖
npm install chokidar      # 文件监听（Config热重载）
npm install @nestjs/event-emitter  # 事件总线

# 已有但 Sprint 2 开始使用
# ioredis — 已安装
```

---

## 目录结构变更

Sprint 2 结束后新增的文件（相对于 Sprint 1）：

```
src/
├── agents/
│   ├── adapters/
│   │   ├── codex.adapter.ts       [NEW]
│   │   ├── codex.adapter.spec.ts  [NEW]
│   │   ├── gemini.adapter.ts      [NEW]
│   │   ├── gemini.adapter.spec.ts [NEW]
│   │   └── index.ts               [MODIFIED - 新增导出]
│   └── services/
│       ├── agent.service.ts         [MODIFIED - 多Agent注册表]
│       ├── agent-config.service.ts  [MODIFIED - 从JSON加载]
│       ├── cli-runner.service.ts    [NEW]
│       ├── cli-runner.service.spec.ts [NEW]
│       ├── decision-engine.service.ts [NEW]
│       └── decision-engine.service.spec.ts [NEW]
├── config/                          [NEW MODULE]
│   ├── config.module.ts             [NEW]
│   └── config-watcher.service.ts    [NEW]
├── memory/
│   ├── memory.module.ts             [MODIFIED - Redis集成]
│   ├── redis.provider.ts            [NEW]
│   └── services/
│       ├── short-term-memory.service.ts  [NEW]
│       ├── shared-memory.service.ts      [NEW]
│       └── event-bus.service.ts          [NEW, 可选]
├── common/
│   ├── filters/
│   │   └── http-exception.filter.ts [NEW]
│   └── interceptors/
│       └── logging.interceptor.ts   [NEW]
├── gateway/
│   └── chat.gateway.ts              [MODIFIED - 决策引擎+流式]
└── app.module.ts                    [MODIFIED - 新增 ConfigModule]

test/
└── sprint2.e2e-spec.ts              [NEW]
```

---

## 任务优先级排序

| 优先级 | 任务 | 天数 | 依赖 |
|--------|------|------|------|
| P0 | 7.1 CLI Runner | Day 1 | 无 |
| P0 | 7.2 Codex Adapter | Day 1-2 | 7.1 |
| P0 | 7.3 Gemini Adapter | Day 1-2 | 7.1 |
| P0 | 7.4 Agent 注册与工厂 | Day 2 | 7.2, 7.3 |
| P0 | 8.1 Decision Engine | Day 3 | 7.4 |
| P0 | 8.2 Gateway 重构 | Day 3-4 | 8.1 |
| P1 | 9.1 Claude Stream | Day 5 | 无 |
| P1 | 9.2 Gateway 流式推送 | Day 5-6 | 9.1 |
| P1 | 10.1 Redis 模块 | Day 7 | 无 |
| P1 | 10.2 短期记忆 | Day 7-8 | 10.1 |
| P1 | 10.3 共享记忆 | Day 8 | 10.1 |
| P2 | 10.4 Pub/Sub | Day 8 | 10.1（可选） |
| P1 | 11.1 Config Watcher | Day 9 | 无 |
| P1 | 11.2 AgentConfig 重构 | Day 9-10 | 11.1, 7.4 |
| P0 | 12.1 E2E 集成测试 | Day 11 | 全部 |
| P1 | 12.2 Bug修复/清理 | Day 11-12 | 12.1 |
| P2 | 12.3 Sprint 1 遗留 | Day 12 | 无 |

---

## 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| Codex CLI 调用不稳定 | 中 | 高 | 增加重试（3次），超时降级返回错误消息 |
| Gemini CLI 输出格式不统一 | 中 | 中 | 统一输出解析器，兜底返回原始 stdout |
| Redis 连接中断 | 低 | 中 | 降级到 DB 查询，Redis reconnect 策略 |
| SSE 流中断 | 中 | 中 | 捕获错误，已接收内容仍然保存并推送 |
| 多 Agent 并发响应顺序不确定 | 低 | 低 | 按 priority 排序，前端按 timestamp 排列 |

---

## 下一步：Sprint 3

Sprint 2 完成后进入 Sprint 3 - 优化增强：

```
Sprint 3 重点:
□ BullMQ 任务队列 / Cron 定时任务
□ ChromaDB 向量检索
□ 记忆自动摘要
□ LangGraph 结构化工作流（可选）
□ 性能优化与压力测试
```

---

**文档版本**: v1.0.0  
**最后更新**: 2026-02-20  
**Sprint状态**: 待开始
