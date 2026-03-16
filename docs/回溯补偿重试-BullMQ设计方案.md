# 回溯功能：主事实提交 + 派生异步补偿重试（BullMQ）设计方案

## 1. 背景与问题

当前 `rewindFromMessage` 采用“失败即整体 rollback”的思路。该方式在跨 PG / Redis / 文件系统场景下成本高，且会放大临时故障（例如 Redis 抖动）。

分布式系统更推荐：
- 主事实（source of truth）优先提交；
- 派生状态（缓存/索引/辅助文件）异步补偿，最终一致。

## 2. 目标

1. 回溯请求到达后，优先完成主事实提交；
2. 派生步骤失败时不回滚主事实，而是进入 BullMQ 重试；
3. 支持重启恢复、指数退避、幂等执行、失败日志可观测。

## 3. 数据分层

### 3.1 主事实（强一致）

- PostgreSQL `messages`（会话消息事实）

### 3.2 派生状态（最终一致）

- Redis ShortTermMemory / SharedMemory
- Chroma 向量索引
- Workspace `transcripts.jsonl`

> 注：若业务要求 transcript 作为审计主事实，可将其提升为强一致层。当前方案按“派生层”处理。

## 4. 新流程

1. FE 发 `message:rewind(sessionId, messageId)`；
2. BE 同步执行主事实提交：
   - 计算边界（anchor + kept/removed）
   - 写入 PG（`replaceSessionMessages`）
3. BE 对派生层逐项尝试（同步快速尝试一次）：
   - transcript 重写
   - shared memory 清理
   - 向量重建 / 短期记忆刷新（由 `replaceSessionMessages` 已处理，失败由补偿兜底）
4. 某派生步骤失败：写入 BullMQ 任务；
5. BullMQ Worker 异步重试执行，成功即完成；超过重试次数进入 failed（保留告警线索）。

## 5. BullMQ 任务设计

## 5.1 队列

- 队列名：`rewind-compensation`

## 5.2 Job 类型

- `rewind.derived_sync`

Payload：
- `sessionId`
- `anchorMessageId`
- `attemptSource`（`gateway`/`service`）
- `requestedAt`

## 5.3 重试策略

- `attempts = 6`
- `backoff = exponential(2s base)`
- `removeOnComplete = 1000`
- `removeOnFail = false`（保留排障）

## 5.4 幂等

- jobId：`rewind:${sessionId}:${anchorMessageId}`（同一回溯只保留一个在途任务）
- Worker 执行逻辑基于当前主事实重建派生，不依赖“增量状态”，天然幂等。

## 6. 代码落点

1. 新增 `RewindCompensationQueueService`（producer + worker）
2. `ChatService.rewindFromMessage` 改造：
   - 主事实提交成功后返回
   - 派生失败 enqueue 补偿任务
3. `ChatModule` 注册该服务（复用现有 Redis 配置）
4. `Gateway` 保持异步响应语义不变

## 7. 可观测性

日志关键字段：
- `sessionId`, `messageId`, `phase(main|derived|enqueue|worker)`
- `attempt`, `jobId`, `error`

建议后续指标：
- 补偿队列积压数
- 重试成功率
- 最终失败数

## 8. Redis 持久化要求

BullMQ 可靠性依赖 Redis 持久化。建议：
- `appendonly yes`
- `appendfsync everysec`
- 保留 RDB `save` 快照策略
- `/data` 挂载持久卷

## 9. 风险与回退

- 若 Worker 不可用，主事实仍正确，但派生状态可能短暂不一致；
- 可通过人工触发“会话派生重建”接口/脚本恢复。
