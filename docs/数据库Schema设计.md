# 数据库Schema设计

> 数据库：PostgreSQL 16+  
> ORM：TypeORM  
> 更新时间：2026-02-18

---

## 📋 目录

- [ER图](#er图)
- [核心表设计](#核心表设计)
- [索引设计](#索引设计)
- [查询优化](#查询优化)
- [数据迁移](#数据迁移)

---

## ER图

```
┌─────────────┐
│    User     │
│  (用户表)    │
└──────┬──────┘
       │ 1
       │ owns
       │ N
       ↓
┌─────────────┐      N        ┌──────────────┐
│   Session   │ ◄──────────── │ SessionAgent │
│  (会话表)    │      N        │ (会话Agent表) │
└──────┬──────┘               └──────┬───────┘
       │ 1                           │ N
       │ has                         │ refers
       │ N                           │ 1
       ↓                             ↓
┌─────────────┐               ┌──────────────┐
│   Message   │               │  AgentConfig │
│  (消息表)    │               │ (Agent配置表) │
└──────┬──────┘               └──────────────┘
       │ N
       │ belongs to
       │ 1
       ↓
┌─────────────┐
│ AgentCall   │
│   Log       │
│ (调用日志表) │
└─────────────┘

┌──────────────┐      1       ┌──────────────┐
│  Workspace   │ ◄──────────  │   Session    │
│ (工作空间表)  │      1       │              │
└──────────────┘              └──────────────┘

┌──────────────┐      N       ┌──────────────┐
│WorkflowExec  │ ◄──────────  │   Session    │
│ (工作流记录)  │      1       │              │
└──────────────┘              └──────────────┘
```

---

## 核心表设计

### 1. users (用户表)

**用途**：存储系统用户信息

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL, -- bcrypt加密
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  
  -- 用户资料
  profile JSONB DEFAULT '{}', -- { avatar, nickname, bio, preferences }
  
  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP,
  
  -- 统计信息
  total_sessions INT DEFAULT 0,
  total_messages INT DEFAULT 0
);

-- 索引
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_last_login ON users(last_login_at DESC);

-- 注释
COMMENT ON TABLE users IS '用户表';
COMMENT ON COLUMN users.profile IS '用户资料JSON: { avatar, nickname, bio, preferences }';
```

**示例数据**：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "username": "developer1",
  "email": "dev@example.com",
  "role": "user",
  "profile": {
    "avatar": "https://avatar.url/user.png",
    "nickname": "前端工程师小王",
    "bio": "热爱编程",
    "preferences": {
      "theme": "dark",
      "language": "zh-CN"
    }
  },
  "created_at": "2026-02-18T00:00:00Z",
  "total_sessions": 15,
  "total_messages": 320
}
```

---

### 2. agent_configs (Agent配置表)

**用途**：存储Agent的配置和状态信息

```sql
CREATE TABLE agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Agent基本信息
  name VARCHAR(50) UNIQUE NOT NULL, -- Claude, Codex, Gemini
  display_name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL, -- claude, codex, gemini, custom
  model VARCHAR(100) NOT NULL,
  
  -- 角色定位
  role TEXT NOT NULL, -- "架构设计与编码实现"
  description TEXT,
  capabilities TEXT[] DEFAULT '{}', -- 能力列表
  
  -- 调用配置
  call_type VARCHAR(10) CHECK (call_type IN ('cli', 'http')),
  config JSONB NOT NULL, -- API配置、CLI参数等
  
  -- 决策规则
  decision_rules JSONB DEFAULT '{}', -- 关键词、阈值等
  
  -- 个性设置
  personality JSONB DEFAULT '{}', -- 风格、响应模式
  
  -- 状态
  status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'busy', 'offline', 'error')),
  enabled BOOLEAN DEFAULT true,
  
  -- 统计信息
  active_connections INT DEFAULT 0,
  total_calls INT DEFAULT 0,
  total_tokens INT DEFAULT 0,
  success_rate FLOAT DEFAULT 0,
  avg_response_time_ms INT DEFAULT 0,
  
  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_health_check TIMESTAMP,
  last_call_at TIMESTAMP,
  
  -- 优先级
  priority INT DEFAULT 5 -- 数字越小优先级越高
);

-- 索引
CREATE INDEX idx_agent_configs_type ON agent_configs(type);
CREATE INDEX idx_agent_configs_status ON agent_configs(status);
CREATE INDEX idx_agent_configs_enabled ON agent_configs(enabled);

-- 注释
COMMENT ON TABLE agent_configs IS 'Agent配置和状态表';
```

**示例数据**：

```json
{
  "id": "agent-001",
  "name": "Claude",
  "display_name": "Claude (架构师)",
  "type": "claude",
  "model": "anthropic/claude-3-sonnet",
  "role": "架构设计与编码实现",
  "capabilities": ["架构设计", "代码生成", "技术选型"],
  "call_type": "http",
  "config": {
    "apiUrl": "https://openrouter.ai/api/v1/chat/completions",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "temperature": 0.7,
    "maxTokens": 4000
  },
  "decision_rules": {
    "keywords": ["架构", "设计", "实现"],
    "autoRespondThreshold": 0.7
  },
  "status": "online",
  "enabled": true,
  "priority": 1
}
```

---

### 3. sessions (会话表)

**用途**：存储聊天会话信息

```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 会话基本信息
  title VARCHAR(200) NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- 参与者
  participants UUID[] DEFAULT '{}', -- 用户ID列表
  active_agents TEXT[] DEFAULT '{}', -- Agent名称列表 (Claude, Codex, Gemini)
  
  -- 会话配置
  mode VARCHAR(20) DEFAULT 'free' CHECK (mode IN ('free', 'structured')),
  workflow_template_id UUID, -- 工作流模板ID（结构化模式）
  
  -- 状态
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  
  -- 统计信息
  message_count INT DEFAULT 0,
  agent_response_count INT DEFAULT 0,
  
  -- 元数据
  metadata JSONB DEFAULT '{}', -- 自定义数据
  tags TEXT[] DEFAULT '{}', -- 标签
  
  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_message_at TIMESTAMP,
  last_active_at TIMESTAMP,
  archived_at TIMESTAMP
);

-- 索引
CREATE INDEX idx_sessions_owner ON sessions(owner_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_last_message ON sessions(last_message_at DESC);
CREATE INDEX idx_sessions_participants ON sessions USING GIN(participants);
CREATE INDEX idx_sessions_tags ON sessions USING GIN(tags);

-- 注释
COMMENT ON TABLE sessions IS '会话表';
COMMENT ON COLUMN sessions.active_agents IS '当前会话活跃的Agent列表';
```

---

### 4. messages (消息表)

**用途**：存储聊天消息

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 关联关系
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  
  -- 发送者
  user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- 用户消息
  agent_id UUID REFERENCES agent_configs(id) ON DELETE SET NULL, -- Agent消息
  agent_name VARCHAR(50), -- Agent名称（冗余存储，方便查询）
  
  -- 消息内容
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  
  -- @提及
  mentioned_agents TEXT[] DEFAULT '{}', -- 被@的Agent名称列表
  is_mention BOOLEAN DEFAULT false, -- 是否包含@提及
  
  -- Agent决策信息
  is_auto_response BOOLEAN DEFAULT false, -- 是否是Agent主动响应
  decision_reason TEXT, -- Agent决策理由
  
  -- 元数据
  metadata JSONB DEFAULT '{}', -- token使用量、生成参数等
  
  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- 软删除
  deleted_at TIMESTAMP
);

-- 索引
CREATE INDEX idx_messages_session ON messages(session_id, created_at DESC);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_agent ON messages(agent_id);
CREATE INDEX idx_messages_role ON messages(role);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_messages_mentions ON messages USING GIN(mentioned_agents);

-- 全文搜索索引
CREATE INDEX idx_messages_content_fts ON messages USING gin(to_tsvector('simple', content));

-- 注释
COMMENT ON TABLE messages IS '聊天消息表';
COMMENT ON COLUMN messages.mentioned_agents IS '被@提及的Agent列表';
COMMENT ON COLUMN messages.is_auto_response IS 'Agent是否主动响应（非被@触发）';
```

**示例数据**：

```json
{
  "id": "msg-001",
  "session_id": "session-001",
  "user_id": "user-001",
  "role": "user",
  "content": "@Claude 帮我设计一个用户系统",
  "mentioned_agents": ["Claude"],
  "is_mention": true,
  "created_at": "2026-02-18T10:00:00Z"
}
```

---

### 5. workspaces (工作空间表)

**用途**：存储会话的共享工作空间

```sql
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID UNIQUE NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  
  -- 代码仓库
  code_repository JSONB DEFAULT '{"files": []}', -- 文件列表
  
  -- 任务列表
  tasks JSONB DEFAULT '[]', -- 任务数组
  
  -- 技术文档
  documentation JSONB DEFAULT '[]', -- 文档数组
  
  -- 决策记录
  decisions JSONB DEFAULT '[]', -- 决策数组
  
  -- 技术栈
  tech_stack JSONB DEFAULT '{"backend": [], "frontend": [], "database": [], "infrastructure": []}',
  
  -- 统计信息
  file_count INT DEFAULT 0,
  task_count INT DEFAULT 0,
  completed_task_count INT DEFAULT 0,
  
  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_file_update TIMESTAMP,
  last_task_update TIMESTAMP
);

-- 索引
CREATE INDEX idx_workspaces_session ON workspaces(session_id);

-- 注释
COMMENT ON TABLE workspaces IS '会话工作空间表';
COMMENT ON COLUMN workspaces.code_repository IS '代码仓库JSON结构';
```

**code_repository JSON结构**：

```json
{
  "files": [
    {
      "id": "file-001",
      "path": "src/controllers/UserController.ts",
      "content": "export class UserController {...}",
      "language": "typescript",
      "author": "claude-001",
      "authorName": "Claude",
      "version": 2,
      "lastModifiedBy": "claude-001",
      "createdAt": "2026-02-18T10:00:00Z",
      "updatedAt": "2026-02-18T10:05:00Z",
      "size": 1024,
      "lineCount": 45
    }
  ],
  "tree": {
    "src": {
      "controllers": ["UserController.ts"],
      "services": ["AuthService.ts"]
    }
  }
}
```

**tasks JSON结构**：

```json
[
  {
    "id": "task-001",
    "title": "实现用户登录",
    "description": "包括JWT认证、密码加密等",
    "status": "completed",
    "assignedTo": "claude-001",
    "assignedToName": "Claude",
    "createdBy": "user-001",
    "priority": "high",
    "tags": ["authentication", "backend"],
    "createdAt": "2026-02-18T09:00:00Z",
    "completedAt": "2026-02-18T10:00:00Z",
    "estimatedHours": 2,
    "actualHours": 1.5
  }
]
```

---

### 6. agent_call_logs (Agent调用日志表)

**用途**：记录每次Agent调用的详细信息

```sql
CREATE TABLE agent_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 关联关系
  agent_id UUID NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  
  -- 调用信息
  call_type VARCHAR(50) NOT NULL, -- 'generate', 'shouldRespond', 'healthCheck'
  
  -- 请求
  prompt TEXT,
  context JSONB, -- 上下文信息
  
  -- 响应
  response TEXT,
  response_metadata JSONB, -- 响应元数据
  
  -- Token使用
  prompt_tokens INT DEFAULT 0,
  completion_tokens INT DEFAULT 0,
  total_tokens INT DEFAULT 0,
  
  -- 性能指标
  latency_ms INT NOT NULL, -- 延迟（毫秒）
  
  -- 状态
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  error_code VARCHAR(50),
  
  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_agent_call_logs_agent ON agent_call_logs(agent_id, created_at DESC);
CREATE INDEX idx_agent_call_logs_session ON agent_call_logs(session_id);
CREATE INDEX idx_agent_call_logs_success ON agent_call_logs(success);
CREATE INDEX idx_agent_call_logs_created ON agent_call_logs(created_at DESC);

-- 分区（可选，用于历史数据管理）
-- CREATE TABLE agent_call_logs_2026_02 PARTITION OF agent_call_logs
--   FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- 注释
COMMENT ON TABLE agent_call_logs IS 'Agent调用日志表';
```

---

### 7. workflow_executions (工作流执行记录表)

**用途**：记录结构化工作流的执行历史

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 关联关系
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  
  -- 工作流信息
  workflow_type VARCHAR(100) NOT NULL, -- 'full-development', 'quick-prototype', etc.
  workflow_template_id UUID, -- 模板ID
  
  -- 状态
  initial_state JSONB NOT NULL, -- 初始输入
  current_state JSONB, -- 当前状态
  final_state JSONB, -- 最终输出
  
  -- 执行日志
  execution_log JSONB DEFAULT '[]', -- 每个节点的执行记录
  
  -- 状态
  status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  
  -- 错误信息
  error TEXT,
  error_node VARCHAR(100), -- 出错的节点
  
  -- 时间戳
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  
  -- 性能指标
  total_duration_ms INT, -- 总耗时
  node_count INT, -- 节点数量
  
  -- 参与的Agent
  involved_agents TEXT[] DEFAULT '{}' -- 参与的Agent列表
);

-- 索引
CREATE INDEX idx_workflow_exec_session ON workflow_executions(session_id, started_at DESC);
CREATE INDEX idx_workflow_exec_status ON workflow_executions(status);
CREATE INDEX idx_workflow_exec_type ON workflow_executions(workflow_type);

-- 注释
COMMENT ON TABLE workflow_executions IS '工作流执行记录表';
```

**execution_log JSON结构**：

```json
[
  {
    "node": "claude_design",
    "agentId": "claude-001",
    "timestamp": "2026-02-18T10:00:00Z",
    "input": { "userRequirement": "实现登录" },
    "output": { "design": "...", "code": "..." },
    "duration": 5230,
    "success": true
  },
  {
    "node": "codex_review",
    "agentId": "codex-001",
    "timestamp": "2026-02-18T10:00:06Z",
    "input": { "code": "..." },
    "output": { "review": "..." },
    "duration": 3120,
    "success": true
  }
]
```

---

### 8. memory_snapshots (记忆快照表)

**用途**：定期备份会话记忆，用于恢复和分析

```sql
CREATE TABLE memory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 关联关系
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  
  -- 记忆内容
  short_term_memory JSONB, -- 短期记忆快照
  shared_memory JSONB, -- 共享记忆快照
  
  -- 摘要
  summary TEXT, -- 对话摘要
  
  -- 统计信息
  message_count INT DEFAULT 0,
  total_tokens INT DEFAULT 0,
  
  -- 快照类型
  snapshot_type VARCHAR(20) DEFAULT 'auto' CHECK (snapshot_type IN ('auto', 'manual', 'scheduled')),
  
  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_memory_snapshots_session ON memory_snapshots(session_id, created_at DESC);

-- 注释
COMMENT ON TABLE memory_snapshots IS '记忆快照表（用于备份和恢复）';
```

---

### 9. session_agents (会话-Agent关联表)

**用途**：记录哪些Agent参与了哪些会话

```sql
CREATE TABLE session_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 关联关系
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
  
  -- 参与状态
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'removed')),
  
  -- 统计信息
  message_count INT DEFAULT 0, -- 该Agent在此会话的消息数
  auto_response_count INT DEFAULT 0, -- 主动响应次数
  mentioned_count INT DEFAULT 0, -- 被@次数
  
  -- 贡献度
  contribution_score FLOAT DEFAULT 0, -- 贡献分（算法计算）
  
  -- 时间戳
  joined_at TIMESTAMP DEFAULT NOW(),
  last_active_at TIMESTAMP,
  left_at TIMESTAMP,
  
  -- 唯一约束
  UNIQUE(session_id, agent_id)
);

-- 索引
CREATE INDEX idx_session_agents_session ON session_agents(session_id);
CREATE INDEX idx_session_agents_agent ON session_agents(agent_id);

-- 注释
COMMENT ON TABLE session_agents IS '会话-Agent关联表';
```

---

### 10. workspace_files (工作空间文件表)

**用途**：详细记录工作空间中的文件（可选，作为workspaces表JSONB的关系型补充）

```sql
CREATE TABLE workspace_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 关联关系
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  
  -- 文件信息
  file_path VARCHAR(500) NOT NULL, -- 文件路径
  file_name VARCHAR(255) NOT NULL, -- 文件名
  content TEXT NOT NULL, -- 文件内容
  language VARCHAR(50), -- 编程语言
  
  -- 版本信息
  version INT DEFAULT 1,
  parent_version UUID, -- 父版本ID（用于版本链）
  
  -- 作者信息
  author_id UUID NOT NULL, -- agent_id 或 user_id
  author_type VARCHAR(20) CHECK (author_type IN ('agent', 'user')),
  author_name VARCHAR(100),
  
  -- 修改信息
  last_modified_by UUID,
  change_description TEXT, -- 修改说明
  
  -- 元数据
  metadata JSONB DEFAULT '{}', -- 大小、行数等
  
  -- 状态
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'deleted', 'archived')),
  
  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- 唯一约束（同一工作空间下路径唯一）
  UNIQUE(workspace_id, file_path, version)
);

-- 索引
CREATE INDEX idx_workspace_files_workspace ON workspace_files(workspace_id);
CREATE INDEX idx_workspace_files_session ON workspace_files(session_id);
CREATE INDEX idx_workspace_files_path ON workspace_files(file_path);
CREATE INDEX idx_workspace_files_author ON workspace_files(author_id);

-- 注释
COMMENT ON TABLE workspace_files IS '工作空间文件表（文件版本历史）';
```

---

### 11. task_records (任务记录表)

**用途**：记录消息队列中的任务执行情况

```sql
CREATE TABLE task_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 关联关系
  job_id VARCHAR(255) UNIQUE NOT NULL, -- BullMQ Job ID
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agent_configs(id) ON DELETE SET NULL,
  
  -- 任务信息
  task_type VARCHAR(100) NOT NULL, -- 'code-generation', 'code-review', etc.
  task_data JSONB NOT NULL, -- 任务数据
  
  -- 状态
  status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'failed', 'cancelled')),
  progress INT DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  
  -- 结果
  result JSONB,
  error TEXT,
  
  -- 重试信息
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  
  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  -- 性能
  duration_ms INT
);

-- 索引
CREATE INDEX idx_task_records_job ON task_records(job_id);
CREATE INDEX idx_task_records_session ON task_records(session_id);
CREATE INDEX idx_task_records_status ON task_records(status);

-- 注释
COMMENT ON TABLE task_records IS '任务记录表（BullMQ任务追踪）';
```

---

## 索引设计

### 查询性能优化索引

```sql
-- 1. 会话最近消息查询（高频）
CREATE INDEX idx_messages_session_recent 
  ON messages(session_id, created_at DESC) 
  WHERE deleted_at IS NULL;

-- 2. Agent统计查询
CREATE INDEX idx_agent_call_logs_stats 
  ON agent_call_logs(agent_id, success, created_at);

-- 3. 用户会话列表（分页）
CREATE INDEX idx_sessions_user_list 
  ON sessions(owner_id, last_message_at DESC) 
  WHERE status = 'active';

-- 4. 全文搜索（消息内容）
CREATE INDEX idx_messages_search 
  ON messages USING gin(to_tsvector('simple', content));

-- 5. Agent活跃度查询
CREATE INDEX idx_session_agents_contribution 
  ON session_agents(agent_id, contribution_score DESC);
```

---

## 查询优化

### 常用查询示例

#### 1. 获取会话最近消息（含Agent信息）

```sql
SELECT 
  m.id,
  m.role,
  m.content,
  m.created_at,
  COALESCE(u.username, a.name) as sender_name,
  a.display_name as agent_display_name,
  m.mentioned_agents
FROM messages m
LEFT JOIN users u ON m.user_id = u.id
LEFT JOIN agent_configs a ON m.agent_id = a.id
WHERE m.session_id = $1 
  AND m.deleted_at IS NULL
ORDER BY m.created_at DESC
LIMIT 50;
```

#### 2. Agent活跃度统计

```sql
SELECT 
  a.name,
  a.display_name,
  COUNT(m.id) as message_count,
  COUNT(CASE WHEN m.is_auto_response THEN 1 END) as auto_response_count,
  COUNT(CASE WHEN m.is_mention THEN 1 END) as mentioned_count,
  AVG(acl.latency_ms) as avg_latency,
  SUM(acl.total_tokens) as total_tokens
FROM agent_configs a
LEFT JOIN messages m ON m.agent_id = a.id
LEFT JOIN agent_call_logs acl ON acl.agent_id = a.id
WHERE m.session_id = $1
GROUP BY a.id, a.name, a.display_name;
```

#### 3. 工作空间文件查询（带版本历史）

```sql
-- 获取文件的所有版本
SELECT 
  wf.version,
  wf.content,
  wf.author_name,
  wf.change_description,
  wf.updated_at
FROM workspace_files wf
WHERE wf.workspace_id = $1 
  AND wf.file_path = $2
ORDER BY wf.version DESC;

-- 获取最新版本
SELECT DISTINCT ON (file_path)
  *
FROM workspace_files
WHERE workspace_id = $1
  AND status = 'active'
ORDER BY file_path, version DESC;
```

#### 4. 会话摘要查询

```sql
SELECT 
  s.id,
  s.title,
  s.message_count,
  s.active_agents,
  s.last_message_at,
  u.username as owner_name,
  (
    SELECT json_agg(json_build_object(
      'name', a.name,
      'messageCount', sa.message_count
    ))
    FROM session_agents sa
    JOIN agent_configs a ON sa.agent_id = a.id
    WHERE sa.session_id = s.id
  ) as agent_stats
FROM sessions s
JOIN users u ON s.owner_id = u.id
WHERE s.owner_id = $1
  AND s.status = 'active'
ORDER BY s.last_message_at DESC
LIMIT 20;
```

---

## 数据迁移

### 初始化迁移

```typescript
// migrations/001_init_schema.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1708300000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 创建users表
    await queryRunner.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        profile JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_login_at TIMESTAMP,
        total_sessions INT DEFAULT 0,
        total_messages INT DEFAULT 0
      );
    `);
    
    // 2. 创建agent_configs表
    await queryRunner.query(`
      CREATE TABLE agent_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(50) UNIQUE NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        model VARCHAR(100) NOT NULL,
        role TEXT NOT NULL,
        description TEXT,
        capabilities TEXT[] DEFAULT '{}',
        call_type VARCHAR(10) CHECK (call_type IN ('cli', 'http')),
        config JSONB NOT NULL,
        decision_rules JSONB DEFAULT '{}',
        personality JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'offline',
        enabled BOOLEAN DEFAULT true,
        active_connections INT DEFAULT 0,
        total_calls INT DEFAULT 0,
        total_tokens INT DEFAULT 0,
        success_rate FLOAT DEFAULT 0,
        avg_response_time_ms INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_health_check TIMESTAMP,
        last_call_at TIMESTAMP,
        priority INT DEFAULT 5
      );
    `);
    
    // 3. 创建sessions表
    // ... (继续创建其他表)
    
    // 4. 创建索引
    await queryRunner.query(`
      CREATE INDEX idx_users_username ON users(username);
      CREATE INDEX idx_agent_configs_type ON agent_configs(type);
      -- ... 其他索引
    `);
    
    // 5. 插入默认数据
    await this.seedDefaultAgents(queryRunner);
  }
  
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS task_records CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS workflow_executions CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS memory_snapshots CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS workspace_files CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS workspaces CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_call_logs CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS session_agents CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS messages CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS sessions CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_configs CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS users CASCADE;`);
  }
  
  private async seedDefaultAgents(queryRunner: QueryRunner): Promise<void> {
    // 插入默认的三个Agent
    await queryRunner.query(`
      INSERT INTO agent_configs (name, display_name, type, model, role, capabilities, call_type, config, priority)
      VALUES 
        ('Claude', 'Claude (架构师)', 'claude', 'anthropic/claude-3-sonnet', 
         '架构设计与编码实现', 
         ARRAY['架构设计', '代码生成', '技术选型'], 
         'http',
         '{"apiUrl": "https://openrouter.ai/api/v1/chat/completions", "apiKeyEnv": "OPENROUTER_API_KEY", "temperature": 0.7, "maxTokens": 4000}'::jsonb,
         1),
        ('Codex', 'Codex (审查员)', 'codex', 'codex', 
         '代码审查与质量把控', 
         ARRAY['代码审查', '测试建议', '性能优化'], 
         'cli',
         '{"cliCommand": "codex-cli", "timeout": 60000}'::jsonb,
         2),
        ('Gemini', 'Gemini (设计师)', 'gemini', 'gemini-pro', 
         '创意发散与视觉设计', 
         ARRAY['UI设计', 'UX设计', '创意建议'], 
         'cli',
         '{"cliCommand": "gemini-cli", "timeout": 60000, "apiKeyEnv": "GEMINI_API_KEY"}'::jsonb,
         3);
    `);
  }
}
```

---

## 数据库配置

### TypeORM配置

```typescript
// ormconfig.ts
import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'admin',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_DATABASE || 'lobster',
  
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  
  synchronize: false, // 生产环境必须false
  logging: process.env.NODE_ENV === 'development',
  
  // 连接池配置
  extra: {
    max: 20, // 最大连接数
    min: 5,  // 最小连接数
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  }
});
```

---

## 性能优化建议

### 1. 查询优化

```sql
-- 使用EXPLAIN分析查询
EXPLAIN ANALYZE
SELECT * FROM messages 
WHERE session_id = 'xxx' 
ORDER BY created_at DESC 
LIMIT 50;

-- 创建复合索引
CREATE INDEX idx_messages_session_created 
  ON messages(session_id, created_at DESC);
```

### 2. 分区表（大数据量场景）

```sql
-- 按月分区agent_call_logs
CREATE TABLE agent_call_logs (
  id UUID DEFAULT gen_random_uuid(),
  created_at TIMESTAMP NOT NULL,
  ...
) PARTITION BY RANGE (created_at);

-- 创建分区
CREATE TABLE agent_call_logs_2026_02 
  PARTITION OF agent_call_logs
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

### 3. 定期清理

```sql
-- 清理3个月前的日志
DELETE FROM agent_call_logs 
WHERE created_at < NOW() - INTERVAL '3 months';

-- 归档旧会话
UPDATE sessions 
SET status = 'archived' 
WHERE last_message_at < NOW() - INTERVAL '30 days'
  AND status = 'active';
```

---

## 备份策略

### 1. 每日全量备份

```bash
# 备份脚本
pg_dump -h localhost -U admin -d lobster -F c -f backup_$(date +%Y%m%d).dump

# 保留最近30天的备份
find backups/ -name "backup_*.dump" -mtime +30 -delete
```

### 2. 实时增量备份（WAL归档）

```sql
-- postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'
```

---

**Schema版本**: v1.0.0  
**最后更新**: 2026-02-18
