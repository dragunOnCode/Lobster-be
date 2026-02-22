# WebSocket 事件文档

## 连接

**Namespace**: `/chat`

**连接参数** (query string):

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | ✅ | 会话 ID |
| `userId` | string | ✅ | 用户 ID |

**连接示例**:

```javascript
const socket = io('http://localhost:3000/chat', {
  query: { sessionId: 'uuid-here', userId: 'user-uuid' },
});
```

---

## 客户端 → 服务端事件

### `message:send`

发送聊天消息。

**Payload**:

```json
{
  "content": "消息内容，可包含 @Claude @Codex @Gemini 提及",
  "sessionId": "会话ID"
}
```

**返回**: `{ "ok": true }` 或 `{ "ok": false }`

---

## 服务端 → 客户端事件

### 连接 / 会话管理

| 事件 | 触发时机 | Payload |
|------|---------|---------|
| `connection:error` | 连接参数缺失 | `{ message }` |
| `chat:history` | 连接成功后发送历史消息 | `ChatMessage[]` |
| `session:presence` | 连接成功后发送会话状态 | `{ sessionId, memberCount, activeSessionCount, timestamp }` |
| `user:joined` | 新成员加入（广播给其他成员） | `{ userId, sessionId, memberCount, activeSessionCount, timestamp }` |
| `user:left` | 成员断开连接 | `{ userId, sessionId, memberCount, activeSessionCount, timestamp }` |

### 消息相关

| 事件 | 触发时机 | Payload |
|------|---------|---------|
| `message:received` | 新消息已保存（用户消息或 Agent 回复） | `ChatMessage` |
| `message:error` | 消息发送失败 | `{ message }` |
| `message:mention` | 消息中包含 @提及 | `{ messageId, mentionedAgents, sessionId }` |

### Agent 决策与响应

| 事件 | 触发时机 | Payload |
|------|---------|---------|
| `agent:thinking` | Agent 开始处理 | `{ agentId, agentName, reason, priority, sessionId, timestamp }` |
| `agent:skip` | Agent 决定不响应 | `{ agentId, agentName, reason, sessionId, timestamp }` |
| `agent:response` | Agent 一次性响应完成 | `{ agentId, agentName, messageId, sessionId, timestamp }` |
| `agent:error` | Agent 执行失败 | `{ sessionId, agentId?, agentName?, error, timestamp }` |

### 流式响应 (Claude)

| 事件 | 触发时机 | Payload |
|------|---------|---------|
| `agent:stream` | 流式增量内容（50ms 节流） | `{ agentId, agentName, sessionId, delta, timestamp }` |
| `agent:stream:end` | 流式响应结束 | `{ agentId, agentName, sessionId, fullContent, timestamp }` |

### 系统通知

| 事件 | 触发时机 | Payload |
|------|---------|---------|
| `system:notification` | 配置热重载等系统事件 | `{ type, message, details?, timestamp }` |

**`system:notification` type 值**:

| type | 说明 |
|------|------|
| `config_reloaded` | Agent 配置热重载成功 |
| `config_reload_failed` | Agent 配置热重载失败 |

### 异常

| 事件 | 触发时机 | Payload |
|------|---------|---------|
| `exception` | WebSocket 未捕获异常 | `{ status: "error", message, timestamp }` |

---

## 数据结构

### ChatMessage

```typescript
interface ChatMessage {
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
```

---

## Agent 路由规则

1. **@提及优先**：消息中包含 `@Claude`、`@Codex`、`@Gemini` 时，仅被提及的 Agent 响应
2. **决策引擎**：无 @提及时，所有 Agent 并行执行 `shouldRespond()` 判断
3. **优先级排序**：`high=10` > `medium=5` > `low=1`
4. **超时保护**：单个 Agent 决策超时 3s 后自动 skip
5. **Claude 流式**：`callType === 'http'` 的 Agent 走 `streamGenerate` 流式推送
6. **CLI Agent 一次性**：`callType === 'cli'` 的 Agent 走 `generate` 单次返回
