# Changelog

## [0.2.0] - Sprint 2: 核心 Agent 系统

### 新增

- **Agent Adapter 体系**
  - ClaudeAdapter (HTTP/OpenRouter, 支持流式)
  - CodexAdapter (CLI)
  - GeminiAdapter (CLI)
  - ConfigDrivenAdapter 包装器，从 `agents.config.json` 驱动元数据
- **Agent 决策引擎** (`DecisionEngineService`)
  - 并行决策：所有 Agent 同时执行 `shouldRespond()`
  - @提及路由：`@Claude` / `@Codex` / `@Gemini` 精确匹配
  - 优先级排序：high > medium > low
  - 3s 超时保护
- **CLI 调用基础设施** (`CliRunnerService`)
  - `execFile` 封装，支持 stdin 输入、超时、退出码处理
  - 专用异常类：`TimeoutError`、`CliExitError`、`CliNotFoundError`
- **Claude 流式响应**
  - SSE 解析 (`data: [DONE]` / `delta.content`)
  - WebSocket 50ms 节流推送 (`agent:stream` / `agent:stream:end`)
- **Redis 记忆系统** (`MemoryModule`)
  - `ShortTermMemoryService`：会话短期记忆，TTL + 最大条数截断
  - `SharedMemoryService`：会话共享状态 (workspaceState, agentDecision)
  - `EventBusService`：Redis Pub/Sub 事件总线
  - `RedisHealthService`：连接健康检查
- **Config 热重载**
  - `ConfigWatcherService`：chokidar 监听 `config/` 目录，500ms debounce
  - `AgentConfigService` 重构：工厂模式动态创建 Adapter，`reload()` diff 逻辑
  - `system:notification` 广播通知前端
- **Agent 注册与工厂** (`AgentConfigService`)
  - 从 `agents.config.json` 加载配置并创建 Adapter 实例
  - 支持 enable/disable/update diff
  - `getFallbackAgentId()` 从全局配置读取
- **异常处理**
  - `HttpExceptionFilter`：统一 HTTP 异常响应格式
  - `WsExceptionFilter`：统一 WebSocket 异常处理
  - `LoggingInterceptor`：请求耗时日志

### 改进

- **Gateway 重构**
  - `ChatGateway` 集成决策引擎、流式响应、共享记忆
  - `SessionManager.broadcastToAll()` 全局广播
  - `MessageRouter` @提及解析
- **ChatService 增强**
  - Redis 短期记忆优先，DB 回退，内存兜底三级缓存策略
  - 自动维护 session 和 transcript
- **AgentService 精简**
  - 移除硬编码 Adapter 注入，由 AgentConfigService 工厂驱动
  - 仅保留注册表管理和 EventBus 订阅

### 修复

- ESLint 配置从失效的 flat config 切换为兼容的 `.eslintrc.js`
- Prettier 配置 JSON 格式修复
- `client.join()` 浮动 Promise 警告修复
- `ChatService` 重复 import 合并
- `.env` 补全 `CODEX_CLI_PATH`、`CODEX_TIMEOUT_MS`、`GEMINI_CLI_PATH`、`GEMINI_TIMEOUT_MS`

---

## [0.1.0] - Sprint 1: 项目初始化

### 新增

- NestJS 项目脚手架
- WebSocket Gateway (Socket.IO) — 连接/断开/消息发送
- SessionManager — 多会话客户端管理
- ChatService — 消息存储 (内存 + DB)
- PostgreSQL + TypeORM (User / Session / Message 实体)
- WorkspaceService — 文件系统会话工作空间
- TranscriptService — JSONL 对话日志
- Docker Compose 基础设施
- 端到端集成测试

