# LangGraph 迁移改造方案

## TODO List

- [x] 明确迁移动机、目标状态与 LangGraph 选型边界
- [x] 新增 `src/langgraph/` 模块骨架并接入主链路
- [x] 用 `ChatGraphState` 承载会话级编排状态
- [x] 支持多 Agent 自由对话、handoff 和流式桥接
- [x] 接入 checkpointer，并提供 thread state / history / replay / restore 调试接口
- [x] 将 `restore` 升级为会话级恢复：graph state、chat messages、workspace transcript、shared memory、short-term memory、vector 索引
- [x] 收敛 Agent 上下文为单入口：graph state 负责 `history / workspaceState / summaries`，检索层只补 `semanticContext`
- [x] 清理遗留上下文路径：下线 `AgentContextOrchestratorService`，移除 Adapter 中未使用的上下文构建依赖
- [x] 明确 `restore` 边界：恢复 graph/chat/transcript/shared memory/vector，不回滚 `workspace/code` 文件树
- [x] 补充关键测试：覆盖 handoff 链、graph 上下文优先级、restore 后会话级状态一致性
- [ ] 设计并验证生产态 checkpointer 运维方案

## 当前结论

当前系统已经完成了“可收敛版本”的核心目标：

- `ChatGateway` 只负责消息入口、会话广播和 graph 事件转发
- `LangGraph` 负责会话级编排、Agent 路由、handoff、状态持久化和调试
- Agent 执行时的主上下文来自 graph state，而不是 Adapter 内部再拼一套 session 上下文

这意味着最关键的问题已经解决：

- 多 Agent 的可见性不再依赖隐式副作用
- Agent-to-Agent handoff 已经是显式路由能力
- 调试入口已经可以直接查看 thread state、history、replay 和 restore

## 目标边界

本次迁移的目标是“会话级可编排、可恢复、可调试”，不是完整 event-sourcing。

已覆盖：

- graph state
- chat messages
- workspace transcript
- shared memory
- short-term memory
- vector 索引

不覆盖：

- `workspace/code` 文件树的时光回退
- 任何已经发生的外部副作用回滚

如果未来需要文件级回退，应单独建设：

- 文件快照或版本化
- 文件副作用与 transcript 的一致性策略
- restore 时的文件树重建逻辑

这不属于当前可收敛版本范围。

## 当前架构状态

### 已完成

- `ChatGateway -> LangGraphOrchestratorService -> FreeChatGraphService` 已成为主链路
- `pendingTasks` + handoff 解析实现了无严格顺序的多 Agent 连续对话
- `graph:agent_stream` / `graph:agent_response` 等事件已桥接到 websocket
- thread 调试接口已支持：
  - `GET /langgraph/threads/:threadId/state`
  - `GET /langgraph/threads/:threadId/history`
  - `GET /langgraph/threads/:threadId/replay`
  - `POST /langgraph/threads/:threadId/restore`

### 已收敛

- graph state 负责：
  - `history`
  - `workspaceState`
  - `summaries`
  - `pendingTasks`
  - `decisions`
  - `agentOutputs`
  - `events`
- `ContextBuilderService` 只负责检索增强：
  - semantic retrieval
  - summary retrieval
  - 可选的 short-term memory fallback
- Adapter 只负责：
  - prompt 组装
  - 调模型
  - 解析响应

### 仍保留的明确限制

- 自由群聊模式仍然是“共享快照 + 队列推进”，不是所有 Agent 同时实时互见
- 生产态 checkpointer 虽已支持 Postgres 驱动，但缺少一份明确的运维方案和故障演练说明

## 迁移后的上下文原则

### 单一真相源

执行期主上下文只认 graph state：

- `conversationHistory` 来自 graph `history`
- `workspaceState` 来自 graph `workspaceState`
- `summaries` 优先来自 graph state，再合并检索补充

### 检索层职责

检索层不再决定主 history，只提供补充材料：

- `semanticContext`
- 可补充的 `summaries`
- 特殊场景下的 short-term memory fallback

### Adapter 职责边界

Adapter 内不再自行回查 session 状态，不再做二次 session 级上下文构建。

## 恢复策略

`restore` 当前语义是“恢复会话状态及其派生存储”。

恢复顺序：

1. 从 checkpoint 读取 graph state
2. 回写当前 thread state
3. 覆盖 chat messages
4. 回写 transcript
5. 重建 shared memory / decisions
6. 重建 short-term memory 和 vector 索引

这套 restore 适用于：

- 会话调试
- 回放某个 checkpoint 后继续对话
- 排查多 Agent 路由是否在某个节点偏离预期

不适用于：

- 文件内容级回退
- 外部命令副作用回滚

## 后续建议

### 近期建议

只做一件事：

- 设计并验证生产态 checkpointer 运维方案

建议内容包括：

- Postgres 连接与权限约束
- schema 初始化与升级方式
- checkpoint 保留策略
- 故障恢复与回放演练

### 不建议立即继续扩的方向

暂时不要继续做：

- 文件级 restore
- 全量 workspace 版本化
- 额外一套 supervisor LLM 编排

这些方向都会显著扩大范围，但不会明显提升当前系统的主价值。

## 关键文件

- `src/gateway/chat.gateway.ts`
- `src/langgraph/services/langgraph-orchestrator.service.ts`
- `src/langgraph/graphs/free-chat.graph.ts`
- `src/langgraph/services/langgraph-thread-debug.service.ts`
- `src/agents/services/context-builder.service.ts`
- `src/agents/services/agent-config.service.ts`
- `config/agents.config.json`
