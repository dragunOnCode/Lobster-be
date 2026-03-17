# 多 Agent 实际编码方案设计（基于工作区能力）

## 1. 背景与目标

你当前系统已经具备：Web 前端对话、多 Agent 路由、LangGraph 编排、CLI 适配器（Claude/Codex/Gemini）、会话级工作区与转录。下一阶段目标是把“聊天式协作”升级为“可执行、可交接、可追溯、可恢复”的真实编码流水线。

本文按你的 6 个考虑点，逐条给出：

1. 现状：当前项目已实现能力
2. 业界：可借鉴实践
3. 思考：取舍与权衡
4. 方法：可落地方案（含多方案对比）

---

## 2. 现状基线（代码盘点）

### 2.1 已具备能力

- 多 Agent 编排主链路：`ChatGateway -> LangGraphOrchestrator -> FreeChatGraph`
- @mention 优先路由与决策引擎
- Agent 间 handoff（基于 `@Agent` 或 `[HANDOFF]...[/HANDOFF]`）
- CLI 调用统一入口（`CliRunnerService`）
- 会话工作区（`workspaceRoot/sessionId/{code,docs}`）
- 会话转录（`transcripts.jsonl`）
- LangGraph 线程调试/回放/恢复（checkpoint、history、restore）
- 回溯与补偿重试队列（BullMQ）

现状证据（代码位置）

- `src/gateway/chat.gateway.ts`
- `src/langgraph/services/langgraph-orchestrator.service.ts`
- `src/langgraph/graphs/free-chat.graph.ts`
- `src/langgraph/services/agent-handoff.service.ts`
- `src/agents/services/cli-runner.service.ts`
- `src/workspace/workspace.service.ts`
- `src/chat/rewind-compensation-queue.service.ts`
- `src/chat/rewind-compensation-worker.service.ts`

### 2.2 关键缺口

- 缺少“编码产物交付协议”（仅本机工作区，不是产品化交付）
- 缺少“跨机器共享工作区”的统一事实源
- 缺少“任务级结构化协作协议”（主程/评审/修复状态机）
- 缺少“思考过程单独建模与审计”
- 未把 CLI 的 MCP/Skills 纳入平台治理（权限、审计、配额）

---

## 3. 总体架构建议（目标态）

## 3.1 架构原则

- 主事实与派生分离：消息/任务/代码提交是主事实，向量/摘要/索引是派生
- 事件驱动：同步链路只做最小闭环，其余异步补偿
- 可重放：每个 Agent 任务可追踪输入、环境、输出、工件
- 可迁移：任务可在任意 worker 执行，不依赖单机本地状态

## 3.2 推荐主线

1. 用户需求进入 `WorkOrder`（任务单）
2. Planner Agent 生成 `Plan`（任务 DAG 或序列）
3. Executor Agent 在隔离工作区执行编码，产出 commit/diff
4. Reviewer Agent（如 Codex）审查并给出结构化问题
5. Fixer Agent 修复，直到满足终止条件
6. 产出可下载工件（zip/patch）与可复用知识（lessons）

---

## 4. 考虑点逐条设计

## 4.1 考虑点 1：工作区代码如何交付给前端用户

### 现状

- 代码落在后端会话工作区目录，前端暂无“工件交付层”。
- 已有 `saveCodeFile` 与 transcript，但没有“导出包/版本标签/可下载链接”标准协议。

### 业界

- CI/CD 与代码平台普遍采用“工件（artifact）”交付。
- GitHub Actions artifact 机制支持上传、保留、下载与校验。

### 思考

- 每次都自动打包会增加延迟与存储成本。
- 仅保留后端文件会让用户缺乏“显式交付物”，不利于验收。
- 最佳策略是“在线工作区 + 按需导出”。

### 方法

方案 A（推荐）：按需导出 + 增量浏览

- 能力：
  - `workspace:list`：目录树
  - `workspace:file:get`：文件内容
  - `workspace:diff`：相对上次交付的变更
  - `workspace:export`：导出 zip / patch
- 优点：用户体验好、成本可控
- 风险：需要工件生命周期管理

方案 B：每轮自动导出

- 优点：审计完整
- 缺点：存储和 IO 压力大

落地建议

1. 增加 `artifacts` 表：`id/sessionId/type(path|zip|patch)/sha256/size/status/createdAt/expiresAt`
2. 增加下载接口：`GET /workspace/:sessionId/artifacts/:artifactId`
3. 前端在 Agent 回合结束时显示“下载本轮产物”
4. 大文件异步打包，返回 jobId + 轮询状态

---

## 4.2 考虑点 2：多 Agent 自主协作（规划->执行->评估->再执行）

### 现状

- 已有 mention 路由、决策与 handoff；
- LangGraph 当前以 `route_current_message -> run_next_task` 迭代执行为主；
- 缺少“任务协议层”和“评审闭环状态机”。

### 业界

- ReAct：边推理边行动，适合动态工具调用。
- Plan-and-Execute：先全局规划，再按步骤执行，成本可控、结构清晰。
- Critique-Revise（主程+评审）在代码生成场景普遍有效。

### 思考

- 纯 ReAct 灵活但轨迹易发散、成本不稳定。
- 纯 Plan-and-Execute 结构化强，但遇到环境噪声时需要重规划机制。
- 代码场景建议“P&E 主干 + ReAct 局部工具调用 + Critic 回路”。

### 方法

推荐工作流（LangGraph 节点）

1. `plan_work`：Planner 输出结构化计划（JSON）
2. `execute_step`：Executor 在 workspace 执行
3. `review_step`：Reviewer 输出结构化审查结果
4. `apply_fix`：Executor/Fixer 修复
5. `judge_done`：是否达成验收标准
6. `replan_if_needed`：失败或偏航时重规划

结构化协议

- `work_order`：`goal, constraints, acceptance_criteria, budget`
- `task_step`：`id, ownerAgent, input, expectedOutput, deps`
- `review_result`：`blocking[], nonBlocking[], risk[]`
- `handoff`：`from,to,reason,contextRef`

终止条件

- `blockingIssues == 0`
- `maxIterations`、`tokenBudget`、`timeBudget` 任一触发

---

## 4.3 考虑点 3：A2A 跨机器协作时的工作区可见性

### 现状

- 工作区是本机文件系统目录；
- 若任务调度到另一台机器，本地改动天然不可见。

### 业界

- 分布式构建/CI 普遍用“远端 Git 作为代码事实源”。
- `git worktree` 支持同仓多工作树并发开发。
- `git bundle` 支持离线场景增量传输。

### 思考

- 直接同步目录（rsync）简单但难以审计与冲突治理。
- 以 Git commit 为交接单位，可天然具备版本、审计、回滚、合并能力。
- 结论：引入 `Workspace Materializer`，统一为“commit 驱动交接”。

### 方法

推荐方案（Git-backed Workspace）

1. 每个 session 对应远端 repo/branch（或 monorepo 子路径）
2. Agent worker 启动任务时：`fetch + checkout(baseCommit)`
3. 执行后提交：`commit + push`
4. 下一 Agent 基于最新 `headCommit` 拉起
5. 系统消息里只传 `commitId/diffRef/artifactRef`，不传文件大对象

核心数据

- `session_workspace_binding(sessionId, repoUrl, branch, headCommit, lockVersion)`
- `agent_task_run(taskId, workerId, baseCommit, outputCommit, status)`

冲突策略

- 默认串行（最稳）
- 进阶：并行分支 + 自动 rebase + reviewer gate

---

## 4.4 考虑点 4：CoT 思考过程展示与追溯（独立成表）

### 现状

- 已有 `agent:thinking` 事件与 decision snapshot；
- 没有“任务级思考轨迹”持久化模型。

### 业界

- 工程实践通常记录“可审计摘要”而非原始长链推理。
- 可观测系统强调 trace/span 关联 message/task/run。

### 思考

- 完整 CoT 原文落库存在安全与合规风险，也会污染上下文。
- 应存“结构化思考摘要”（Plan/Assumption/Risk/NextAction），并可选保存加密原文（仅管理员）。

### 方法

新增数据模型

- `agent_thoughts`
  - `id, sessionId, messageId, taskId, agentId`
  - `phase(planning|executing|reviewing|replanning)`
  - `summary`（对外可见）
  - `privateTrace`（可选、加密、RBAC）
  - `inputRefs`（messageId/commitId/artifactId）
  - `createdAt`

前端呈现

- 聊天消息旁展示“思考摘要时间线”
- 支持按任务/Agent 过滤

策略

- 默认只展示 `summary`
- `privateTrace` 默认关闭，按环境开关

---

## 4.5 考虑点 5：LangGraph 下采用 ReAct / Plan-and-Execute 等范式

### 现状

- LangGraph 已接入、支持 checkpoint 与恢复；
- 当前图以“路由 + 任务执行循环”为主，计划显式性不足。

### 业界

- LangGraph 官方强调 checkpoint/线程/恢复，适合长流程 Agent。
- Plan-and-Execute 在多步骤任务里可降低成本并提升稳定性。

### 思考

- 你的场景是“多 Agent + 真实编码 + 可追踪”，最怕黑箱与失控。
- 推荐主范式：Plan-and-Execute（显式任务）
- 局部范式：ReAct（执行节点内调用 CLI/MCP 工具）

### 方法

图模型升级

- 把 `pendingTasks` 从“隐式队列”升级为“显式 Plan DAG”
- 每个 step 写入：`status, retries, startedAt, endedAt, outputRefs`

重试与补偿

- step 失败：节点内重试（幂等）
- 超过阈值：触发 `replan` 或进入 `human_review`
- 使用 BullMQ 承接长尾失败重跑

评估指标

- 任务成功率
- 平均回合数
- 计划偏离率（replan 次数/任务）
- 每任务 token 与时延成本

---

## 4.6 考虑点 6：在 CLI 自带 MCP/Skills 基础上做平台增强

### 现状

- 目前 CLI 由 adapter 触发，MCP/Skills 使用未被平台治理。
- 缺少统一“工具注册、权限、审计、配额”层。

### 业界

- MCP 正在成为跨模型工具协议标准，强调能力协商与工具调用。
- 平台实践强调“最小权限 + 可审计 + 可撤销”。

### 思考

- 不能把所有 MCP server 全量暴露给所有 Agent。
- 需要“按会话/任务临时授权”的能力沙箱。
- 需要把工具调用视为一等事件，进入可观测体系。

### 方法

能力治理层（Capability Gateway）

1. `capability_registry`
  - `capabilityId, type(mcp|skill|builtin), owner, riskLevel, schema, status`
2. `agent_capability_policy`
  - 哪个 agent 在何条件下可用哪些能力
3. `capability_audit_log`
  - 调用参数摘要、耗时、结果、失败原因

执行控制

- 每次任务下发时生成 `allowedCapabilities` 白名单
- CLI adapter 仅注入白名单 MCP/Skills 配置
- 高风险能力（shell/fs/network）采用二次确认或审批

---

## 5. 可靠性与一致性（横切）

## 5.1 推荐模式

- 同步链路：提交主事实（message/task/commitRef）
- 异步链路：派生状态（索引、摘要、统计、通知）
- 重试耗尽：入 BullMQ
- 最终一致性：补偿任务 + 幂等消费

## 5.2 从当前实现继续增强

- 现已具备“重试 + 入队 + worker 消费”基础，可复用到任务层
- 下一步建议引入 Transactional Outbox，避免“DB 成功但消息未投递”

---

## 6. 分阶段落地计划（建议 3 期）

## Phase 1（2~3 周）：可用闭环

1. 增加 `WorkOrder/TaskStep/ReviewResult` 结构
2. 增加 `workspace:export` 与 artifact 下载
3. 主程->评审->修复最小闭环（串行）
4. 新增 `agent_thoughts.summary`

验收

- `@Claude 实现 -> @Codex 评审 -> Claude 修复` 可自动完成
- 前端可下载 zip/patch

## Phase 2（2~4 周）：分布式就绪

1. 引入 Git-backed workspace materializer
2. 任务执行记录 `baseCommit/outputCommit`
3. 跨 worker 调度可继续开发不丢上下文

验收

- 强制切换 worker 后任务可继续
- 审计可追溯到 commit 级别

## Phase 3（2~4 周）：治理与智能增强

1. MCP/Skills 能力白名单 + 审计
2. Plan DAG + Replan + Human gate
3. Outbox + 端到端 tracing

验收

- 高风险能力可控
- 复杂需求成功率与稳定性提升

---

## 7. 指标体系（上线即采集）

- 任务成功率（一次成功/重试成功/失败）
- 平均交付时长（从用户消息到可下载工件）
- 每任务 token 成本
- 回合数与重规划次数
- 评审阻塞问题关闭率
- 跨 worker 迁移成功率
- 补偿队列积压与重试成功率

---

## 8. 关键技术取舍结论（TL;DR）

1. 交付方式：不做“每轮强制打包”，采用“在线工作区 + 按需工件导出”
2. 协作范式：`Plan-and-Execute` 主干 + `ReAct` 执行细节 + `Critique-Revise` 闭环
3. 分布式工作区：以 Git commit 为交接单位，而非目录同步
4. 思考可追溯：默认存结构化摘要，不默认暴露完整 CoT
5. 可靠性：主事实同步提交，派生状态异步补偿，逐步引入 Outbox
6. CLI 增强：MCP/Skills 必须纳入能力治理与审计

---

## 9. 外部参考（业界资料）

1. LangGraph Persistence（checkpoint/thread/replay/fault-tolerance）

- [https://docs.langchain.com/oss/javascript/langgraph/persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)

1. LangChain Plan-and-Execute / Planning Agents

- [https://blog.langchain.com/planning-agents](https://blog.langchain.com/planning-agents)

1. BullMQ 重试与退避

- [https://docs.bullmq.io/guide/retrying-failing-jobs](https://docs.bullmq.io/guide/retrying-failing-jobs)

1. MCP 官方与 Anthropic 文档

- [https://modelcontextprotocol.io/specification/2025-03-26/basic/index](https://modelcontextprotocol.io/specification/2025-03-26/basic/index)
- [https://github.com/modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol)
- [https://docs.anthropic.com/en/docs/claude-code/mcp](https://docs.anthropic.com/en/docs/claude-code/mcp)

1. Git 工作树与离线分发

- [https://git-scm.com/docs/git-worktree](https://git-scm.com/docs/git-worktree)
- [https://git-scm.com/docs/git-bundle](https://git-scm.com/docs/git-bundle)

1. 分布式一致性（Saga / Outbox）

- [https://microservices.io/patterns/data/saga.html](https://microservices.io/patterns/data/saga.html)
- [https://microservices.io/patterns/data/transactional-outbox](https://microservices.io/patterns/data/transactional-outbox)
- [https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga.html](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga.html)

