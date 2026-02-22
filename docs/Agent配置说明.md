# Agent配置文件

> 文件说明：定义系统中所有AI Agent的配置信息  
> 路径：`config/agents.config.json`

```json
{
  "agents": [
    {
      "id": "claude-001",
      "name": "Claude",
      "displayName": "Claude (架构师)",
      "type": "claude",
      "model": "anthropic/claude-3-sonnet",
      "role": "架构设计与编码实现",
      "description": "专业的软件架构师和全栈开发者，擅长系统设计、代码实现和技术选型",
      "capabilities": [
        "系统架构设计",
        "后端开发",
        "前端开发",
        "代码生成",
        "技术选型",
        "代码重构",
        "API设计"
      ],
      "callType": "http",
      "config": {
        "apiUrl": "https://openrouter.ai/api/v1/chat/completions",
        "apiKeyEnv": "OPENROUTER_API_KEY",
        "temperature": 0.7,
        "maxTokens": 4000,
        "timeout": 60000,
        "retryAttempts": 3,
        "retryDelay": 2000
      },
      "personality": {
        "style": "专业、严谨、注重架构设计",
        "responsePattern": "先分析需求 → 设计方案 → 给出代码 → 说明关键点"
      },
      "decisionRules": {
        "keywords": [
          "架构",
          "设计",
          "实现",
          "代码",
          "开发",
          "重构",
          "优化",
          "模块",
          "系统",
          "API",
          "接口",
          "功能"
        ],
        "alwaysRespondToMentions": true,
        "autoRespondThreshold": 0.7,
        "maxConcurrentTasks": 3
      },
      "enabled": true,
      "priority": 1
    },
    {
      "id": "codex-001",
      "name": "Codex",
      "displayName": "Codex (审查员)",
      "type": "codex",
      "model": "codex",
      "role": "代码审查与质量把控",
      "description": "专业的代码审查专家，关注代码质量、性能、安全和最佳实践",
      "capabilities": [
        "代码审查",
        "质量检测",
        "性能分析",
        "安全审计",
        "测试建议",
        "重构建议",
        "最佳实践"
      ],
      "callType": "cli",
      "config": {
        "cliCommand": "codex-cli",
        "cliArgs": [
          "--format",
          "json",
          "--max-tokens",
          "3000"
        ],
        "timeout": 60000,
        "retryAttempts": 3,
        "workingDirectory": null
      },
      "personality": {
        "style": "严谨、批判性思维、注重细节",
        "responsePattern": "发现问题 → 分析影响 → 给出建议 → 提供改进方案"
      },
      "decisionRules": {
        "keywords": [
          "审查",
          "检查",
          "测试",
          "问题",
          "bug",
          "错误",
          "性能",
          "安全",
          "质量",
          "优化",
          "规范"
        ],
        "alwaysRespondToMentions": true,
        "autoRespondThreshold": 0.6,
        "autoRespondToCodeChanges": true,
        "codeChangeDetectionDelay": 5000,
        "maxConcurrentTasks": 2
      },
      "enabled": true,
      "priority": 2
    },
    {
      "id": "gemini-001",
      "name": "Gemini",
      "displayName": "Gemini (设计师)",
      "type": "gemini",
      "model": "gemini-pro",
      "role": "创意发散与视觉设计",
      "description": "富有创意的设计师和产品顾问，关注用户体验、界面设计和创新思维",
      "capabilities": [
        "UI设计",
        "UX设计",
        "交互设计",
        "视觉方案",
        "创意建议",
        "用户体验优化",
        "产品思维"
      ],
      "callType": "cli",
      "config": {
        "cliCommand": "gemini-cli",
        "cliArgs": [
          "--format",
          "json",
          "--temperature",
          "0.8",
          "--max-tokens",
          "3000"
        ],
        "apiKeyEnv": "GEMINI_API_KEY",
        "timeout": 60000,
        "retryAttempts": 3
      },
      "personality": {
        "style": "创意、友好、关注用户需求",
        "responsePattern": "理解用户痛点 → 提出创意方案 → 设计细节 → 用户体验考量"
      },
      "decisionRules": {
        "keywords": [
          "设计",
          "界面",
          "UI",
          "UX",
          "体验",
          "创意",
          "视觉",
          "样式",
          "布局",
          "用户",
          "交互",
          "美观"
        ],
        "alwaysRespondToMentions": true,
        "autoRespondThreshold": 0.5,
        "maxConcurrentTasks": 2
      },
      "enabled": true,
      "priority": 3
    }
  ],
  "globalSettings": {
    "maxAgentsPerSession": 10,
    "defaultMode": "free",
    "enableAutoResponse": true,
    "healthCheckInterval": 30000,
    "agentResponseTimeout": 120000
  }
}
```

## 配置说明

### Agent配置字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | Agent唯一标识符 |
| `name` | string | Agent名称（用于@提及） |
| `displayName` | string | 前端显示名称 |
| `type` | string | Agent类型（claude/codex/gemini/custom） |
| `model` | string | 底层模型名称 |
| `role` | string | Agent角色定位 |
| `description` | string | Agent描述 |
| `capabilities` | string[] | 能力列表 |
| `callType` | enum | 调用方式（cli/http） |
| `config.timeout` | number | 超时时间（毫秒） |
| `config.retryAttempts` | number | 重试次数 |
| `decisionRules.keywords` | string[] | 触发响应的关键词 |
| `decisionRules.alwaysRespondToMentions` | boolean | 被@时是否总是响应 |
| `decisionRules.autoRespondThreshold` | number | 自动响应阈值（0-1） |
| `enabled` | boolean | 是否启用 |
| `priority` | number | 优先级（数字越小优先级越高） |

### CLI配置说明

#### Codex CLI

```bash
# 安装Codex CLI（假设）
npm install -g codex-cli

# 配置API Key
codex-cli config set api_key YOUR_API_KEY

# 测试调用
codex-cli --prompt "审查这段代码" --format json
```

#### Gemini CLI

```bash
# 安装Gemini CLI
npm install -g @google/generative-ai-cli

# 配置API Key
export GEMINI_API_KEY=your_api_key

# 测试调用
gemini-cli --prompt "设计一个登录界面" --format json
```

### HTTP API配置说明

#### Claude (OpenRouter)

```typescript
// 调用示例
const response = await axios.post(
  'https://openrouter.ai/api/v1/chat/completions',
  {
    model: 'anthropic/claude-3-sonnet',
    messages: [{ role: 'user', content: 'Hello' }]
  },
  {
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://lobster.com',
      'X-Title': 'Lobster Coding Assistant'
    }
  }
);
```

### 添加自定义Agent

用户可以通过管理界面或API动态添加新Agent：

```json
{
  "id": "gpt4-001",
  "name": "GPT4",
  "type": "custom",
  "model": "gpt-4",
  "role": "通用AI助手",
  "capabilities": ["通用对话", "知识问答"],
  "callType": "http",
  "config": {
    "apiUrl": "https://api.openai.com/v1/chat/completions",
    "apiKeyEnv": "OPENAI_API_KEY",
    "temperature": 0.7,
    "maxTokens": 2000
  },
  "decisionRules": {
    "keywords": ["帮助", "解释", "什么是"],
    "alwaysRespondToMentions": true,
    "autoRespondThreshold": 0.4
  },
  "enabled": true
}
```

### 决策规则详解

#### 1. 关键词匹配

Agent根据消息中的关键词判断是否应该响应。

**示例**：
- 用户说"设计一个登录界面" → Gemini检测到"设计"和"界面" → 决定响应
- 用户说"这段代码有问题吗" → Codex检测到"代码"和"问题" → 决定响应

#### 2. @提及优先级

被@提及的Agent拥有最高优先级，必定响应（除非disabled）。

```
优先级：
@提及 (Priority: 10) > 关键词匹配 (Priority: 5) > 上下文相关 (Priority: 2)
```

#### 3. 自动响应阈值

`autoRespondThreshold`（0-1）控制Agent的"积极性"：
- **0.9**：非常保守，只在非常相关时才响应
- **0.7**：默认值，平衡
- **0.5**：较积极，容易参与讨论
- **0.3**：非常积极，几乎总是响应

#### 4. Codex特殊规则：代码变化监听

Codex独有配置：`autoRespondToCodeChanges: true`

当共享工作空间有新代码文件添加/修改时，Codex会：
1. 等待 `codeChangeDetectionDelay`（5秒）
2. 自动触发审查流程
3. 主动在聊天室中发言

**效果**：
```
Claude: 我已经生成了 UserController.ts
[5秒后]
Codex: 我看到新增了代码文件，让我审查一下...
       代码整体结构良好，有几点建议：...
```

---

## 环境变量配置

创建 `.env` 文件：

```bash
# ==================== 应用配置 ====================
NODE_ENV=development
PORT=3000
API_PREFIX=api

# ==================== 数据库配置 ====================
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=admin
DB_PASSWORD=password
DB_DATABASE=lobster

# ==================== Redis配置 ====================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# ==================== JWT配置 ====================
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ==================== Agent API Keys ====================
# Claude (OpenRouter)
OPENROUTER_API_KEY=your_openrouter_api_key

# Codex CLI (假设需要配置)
CODEX_API_KEY=your_codex_api_key

# Gemini CLI
GEMINI_API_KEY=your_gemini_api_key

# ==================== ChromaDB配置 ====================
CHROMA_HOST=localhost
CHROMA_PORT=8000

# ==================== MinIO配置 ====================
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

# ==================== 日志配置 ====================
LOG_LEVEL=debug
LOG_PRETTY=true

# ==================== Agent配置路径 ====================
AGENT_CONFIG_PATH=config/agents.config.json
```

## 快速启动指南

### 1. 安装CLI工具

```bash
# Gemini CLI
npm install -g @google/generative-ai-cli

# Codex CLI（假设存在，需要根据实际工具调整）
npm install -g codex-cli

# 配置API Keys
export GEMINI_API_KEY=your_key
export CODEX_API_KEY=your_key
```

### 2. 测试Agent调用

```bash
# 测试Claude (OpenRouter)
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "anthropic/claude-3-sonnet", "messages": [{"role": "user", "content": "Hello"}]}'

# 测试Gemini CLI
gemini-cli --prompt "Hello" --format json

# 测试Codex CLI
codex-cli --prompt "审查代码" --format json
```

### 3. 启动系统

```bash
# 启动依赖服务
docker-compose up -d

# 启动NestJS应用
npm run start:dev
```

---

## 自定义Agent指南

### 添加新Agent步骤

1. **编辑配置文件** `config/agents.config.json`
2. **添加Agent配置**（参考上面的示例）
3. **实现Adapter**（如果是新类型）
4. **重启应用**（或热重载）

### Agent Adapter实现模板

```typescript
@Injectable()
export class CustomAdapter implements ILLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly type: string;
  readonly role: string;
  readonly capabilities: string[];
  readonly callType: 'cli' | 'http';
  
  constructor(private config: AgentConfig) {
    Object.assign(this, config);
  }
  
  async generate(prompt: string, context: AgentContext): Promise<AgentResponse> {
    // TODO: 实现调用逻辑
  }
  
  async shouldRespond(message: ChatMessage, context: AgentContext): Promise<{ should: boolean; reason?: string }> {
    // TODO: 实现决策逻辑
  }
  
  async healthCheck(): Promise<boolean> {
    // TODO: 实现健康检查
  }
  
  getStatus(): AgentStatus {
    // TODO: 返回当前状态
  }
}
```

---

**配置版本**: v1.0.0  
**最后更新**: 2026-02-18
