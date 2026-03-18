# 考虑点6：CLI 工具能力增强机制设计

> 文档版本：v2.0
> 更新日期：2026-03-18

---

## 看现状

### 当前实现程度

**已实现：**
- ✅ `CliRunnerService`：通过子进程执行 claude/codex/gemini cli，支持流式输出
- ✅ `ILLMAdapter`：适配器接口，屏蔽不同 CLI 的调用差异
- ✅ `agents.config.json`：Agent 级别的静态配置（命令、系统提示、优先级等）

**当前缺失：**
- ❌ 没有 MCP 服务器的注册和管理机制
- ❌ 没有 Skills/Slash Commands 的注册和管理机制
- ❌ CLI 启动时无法动态注入会话级别的配置（MCP、权限、工具白名单等）
- ❌ 开发者无法在不修改代码的情况下为某个 Agent 挂载新的 MCP 服务器
- ❌ 用户无法在运行时为自己的会话启用/禁用特定工具

### CLI 工具自身的能力

这是本考虑点的出发点：**CLI 工具本身已经实现了完整的 Agent 能力**，我们不需要重复造轮子。

| 能力 | Claude Code | Codex CLI | Gemini CLI |
|------|-------------|-----------|------------|
| MCP 服务器 | ✅ 支持，通过 `~/.claude/settings.json` 配置 | ⚠️ 部分支持 | ⚠️ 部分支持 |
| Skills/Slash Commands | ✅ 内置 `/commit`、`/review-pr` 等，支持自定义 | ✅ 支持 | ✅ 支持 |
| 工具调用（Function Calling） | ✅ 原生支持 | ✅ 原生支持 | ✅ 原生支持 |
| 权限控制 | ✅ `allowedTools`、`blockedTools` | ⚠️ 有限 | ⚠️ 有限 |
| 配置文件注入 | ✅ `--config`、环境变量 | ✅ 命令行参数 | ✅ 命令行参数 |

**核心问题**：这些能力都存在，但目前系统在启动 CLI 时是"裸跑"的，没有任何配置注入，等于把 CLI 当成了一个普通的文本生成工具，浪费了它的大量能力。

---

## 看业界

### 业界实践案例

#### 1. VS Code 扩展市场模式

VS Code 本身是编辑器，但通过扩展市场，开发者可以为它注册语言服务器、调试适配器、主题等。用户在工作区级别（`.vscode/settings.json`）或全局级别覆盖配置。

**启发：** 分层配置模型——全局默认 → Agent 级别 → 会话级别，后者覆盖前者。

#### 2. Claude Code 的 MCP 配置机制

Claude Code 本身支持在 `~/.claude/settings.json` 中声明 MCP 服务器：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/workspace"]
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "POSTGRES_URL": "postgresql://..." }
    }
  }
}
```

CLI 启动时会自动连接这些 MCP 服务器，Agent 就能调用它们暴露的工具。

**启发：** 我们只需要在启动 CLI 前，**动态生成这份配置文件**，就能控制 Agent 能访问哪些工具。

#### 3. Cursor Rules / `.cursorrules`

Cursor 允许在项目根目录放置 `.cursorrules` 文件，定义 AI 的行为规则。这是一种"项目级别的 Prompt 注入"。

**启发：** Skills 的注册可以类比为"给 CLI 注入额外的指令集"，通过配置文件而非代码实现。

#### 4. Kubernetes Admission Webhook

K8s 在 Pod 创建前，通过 Webhook 动态注入 sidecar、环境变量、挂载卷等。这是一种"启动前拦截注入"的模式。

**启发：** 在 `CliRunnerService` 执行 CLI 命令前，插入一个"配置注入"阶段，动态组装该次执行的完整配置。

---

## 思考过程

### 核心问题的重新定义

原始问题是"如何增强 MCP/Skills"，但更准确的表述是：

> **如何在业务层建立一套管理机制，让开发者和用户能够声明式地为 CLI 工具注册 MCP 服务器和 Skills，并在 CLI 启动时自动注入？**

这个问题的本质是**配置管理**，而不是工具实现。

### 三个关键决策

**决策1：配置的粒度**

| 粒度 | 说明 | 适用场景 |
|------|------|---------|
| 全局级 | 所有 Agent、所有会话都生效 | 基础工具（文件系统、数据库只读查询） |
| Agent 级 | 特定 Agent 类型生效 | Claude 专用的代码审查 MCP，Gemini 专用的图像分析 MCP |
| 会话级 | 特定会话生效 | 用户为自己的项目挂载私有 MCP 服务器 |

三层叠加，后者覆盖前者。这是最灵活的模型。

**决策2：谁来注册**

- **开发者**：通过代码或配置文件，在系统启动时注册内置 MCP 服务器（如工作区 MCP、数据库只读 MCP）
- **用户**：通过前端 UI 或 API，在会话维度动态添加自己的 MCP 服务器（如连接自己的 GitHub、Notion 等）

**决策3：配置如何注入 CLI**

不同 CLI 的配置注入方式不同：
- Claude Code：支持 `--config <path>` 指定配置文件，或通过环境变量 `CLAUDE_CONFIG_DIR` 指定配置目录
- Codex/Gemini：通过命令行参数或环境变量

因此需要一个**适配层**，将统一的内部配置格式转换为各 CLI 的注入方式。

### 取舍标准

1. **不重复造轮子**：MCP 工具调用、Skills 执行都由 CLI 自己完成，我们只管"注册"和"注入"
2. **声明式优于命令式**：配置写在数据库/配置文件里，而不是硬编码在代码里
3. **隔离性**：不同会话的 MCP 配置互不干扰，通过临时配置文件实现隔离
4. **可观测**：记录每次 CLI 启动时注入了哪些 MCP/Skills，便于调试

---

## 给方法

### 方案设计：CLI 能力管理层（CLI Capability Manager）

#### 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                    业务层（我们负责的部分）                    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  CliCapabilityManager                               │    │
│  │  - 三层配置合并（全局 + Agent + 会话）               │    │
│  │  - 生成临时配置文件                                  │    │
│  │  - 清理临时文件                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                          ↓                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  CliConfigAdapter（适配不同 CLI 的注入方式）          │    │
│  │  - ClaudeConfigAdapter  → --config <path>           │    │
│  │  - CodexConfigAdapter   → 环境变量 + 参数            │    │
│  │  - GeminiConfigAdapter  → 环境变量 + 参数            │    │
│  └─────────────────────────────────────────────────────┘    │
│                          ↓                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  CliRunnerService（现有，增加配置注入钩子）            │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
                          ↓ 启动 CLI 子进程
┌──────────────────────────────────────────────────────────────┐
│              CLI 工具层（厂商实现，我们不修改）               │
│                                                              │
│   Claude Code CLI  ←→  MCP Server A  ←→  MCP Server B       │
│   Codex CLI        ←→  MCP Server C                         │
│   Gemini CLI       ←→  MCP Server D                         │
└──────────────────────────────────────────────────────────────┘
```

#### 数据库设计

**表1：mcp_server_registrations（MCP 服务器注册表）**

```sql
CREATE TABLE mcp_server_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 作用域
  scope VARCHAR(20) NOT NULL, -- 'global' | 'agent' | 'session'
  scope_id VARCHAR(100),      -- agent_id 或 session_id，global 时为 null

  -- 适用的 CLI 类型
  cli_types TEXT[] NOT NULL DEFAULT '{claude,codex,gemini}',

  -- MCP 服务器配置
  name VARCHAR(100) NOT NULL,       -- 在 CLI 配置中的键名，如 "workspace"
  display_name VARCHAR(200),        -- 展示给用户的名称
  description TEXT,

  -- 启动方式
  transport VARCHAR(20) NOT NULL DEFAULT 'stdio', -- 'stdio' | 'sse'
  command TEXT,                     -- stdio 模式：启动命令，如 "node"
  args JSONB,                       -- stdio 模式：参数列表
  url TEXT,                         -- sse 模式：服务器 URL
  env JSONB,                        -- 环境变量（支持 ${SESSION_ID} 等占位符）

  -- 权限控制
  enabled BOOLEAN NOT NULL DEFAULT true,
  allowed_tools TEXT[],             -- 白名单，null 表示全部允许
  blocked_tools TEXT[],             -- 黑名单

  -- 元数据
  created_by VARCHAR(100),          -- 'system' | user_id
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_mcp_registrations_scope ON mcp_server_registrations(scope, scope_id);
CREATE INDEX idx_mcp_registrations_cli ON mcp_server_registrations USING GIN(cli_types);
```

**表2：skill_registrations（Skills 注册表）**

```sql
CREATE TABLE skill_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 作用域（同上）
  scope VARCHAR(20) NOT NULL,
  scope_id VARCHAR(100),

  -- 适用的 CLI 类型
  cli_types TEXT[] NOT NULL DEFAULT '{claude}',

  -- Skill 配置
  name VARCHAR(100) NOT NULL,       -- slash command 名称，如 "sync-workspace"
  display_name VARCHAR(200),
  description TEXT,

  -- 执行方式（Claude Code Skills 格式）
  command TEXT NOT NULL,            -- 执行命令
  args JSONB,

  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_skill_registrations_scope ON skill_registrations(scope, scope_id);
```

#### 核心服务实现

**CliCapabilityManager**

```typescript
// src/agents/services/cli-capability-manager.service.ts

@Injectable()
export class CliCapabilityManagerService {
  constructor(
    @InjectRepository(McpServerRegistration)
    private readonly mcpRepo: Repository<McpServerRegistration>,
    @InjectRepository(SkillRegistration)
    private readonly skillRepo: Repository<SkillRegistration>
  ) {}

  /**
   * 为一次 CLI 执行解析出完整的能力配置
   * 合并顺序：全局 → Agent 级 → 会话级（后者覆盖前者）
   */
  async resolveCapabilities(
    cliType: 'claude' | 'codex' | 'gemini',
    agentId: string,
    sessionId: string
  ): Promise<ResolvedCapabilities> {
    // 查询三层 MCP 注册
    const mcpRegistrations = await this.mcpRepo.find({
      where: [
        { scope: 'global', enabled: true },
        { scope: 'agent', scopeId: agentId, enabled: true },
        { scope: 'session', scopeId: sessionId, enabled: true }
      ]
    });

    // 过滤出支持当前 CLI 类型的注册
    const applicableMcps = mcpRegistrations.filter(r =>
      r.cliTypes.includes(cliType)
    );

    // 合并（同名的后者覆盖前者）
    const mcpMap = new Map<string, McpServerRegistration>();
    for (const reg of applicableMcps) {
      mcpMap.set(reg.name, reg);
    }

    // 同理处理 Skills
    const skillRegistrations = await this.skillRepo.find({
      where: [
        { scope: 'global', enabled: true },
        { scope: 'agent', scopeId: agentId, enabled: true },
        { scope: 'session', scopeId: sessionId, enabled: true }
      ]
    });

    const applicableSkills = skillRegistrations.filter(r =>
      r.cliTypes.includes(cliType)
    );

    return {
      mcpServers: Array.from(mcpMap.values()),
      skills: applicableSkills
    };
  }

  /**
   * 将占位符替换为实际值
   * 支持 ${SESSION_ID}、${AGENT_ID}、${WORKSPACE_PATH} 等
   */
  interpolateEnv(
    env: Record<string, string>,
    context: { sessionId: string; agentId: string; workspacePath: string }
  ): Record<string, string> {
    const replacements: Record<string, string> = {
      SESSION_ID: context.sessionId,
      AGENT_ID: context.agentId,
      WORKSPACE_PATH: context.workspacePath
    };

    return Object.fromEntries(
      Object.entries(env).map(([k, v]) => [
        k,
        v.replace(/\$\{(\w+)\}/g, (_, key) => replacements[key] ?? '')
      ])
    );
  }
}
```

**ClaudeConfigAdapter（以 Claude Code 为例）**

```typescript
// src/agents/adapters/cli-config/claude-config.adapter.ts

@Injectable()
export class ClaudeConfigAdapter {
  constructor(
    private readonly capabilityManager: CliCapabilityManagerService
  ) {}

  /**
   * 生成 Claude Code 的临时配置文件，返回注入参数
   */
  async buildInjectArgs(
    agentId: string,
    sessionId: string,
    workspacePath: string
  ): Promise<{ args: string[]; env: Record<string, string>; cleanup: () => Promise<void> }> {
    const capabilities = await this.capabilityManager.resolveCapabilities(
      'claude', agentId, sessionId
    );

    // 构建 Claude Code settings.json 格式
    const settings: ClaudeSettings = {
      mcpServers: {},
      skills: {}
    };

    for (const mcp of capabilities.mcpServers) {
      const resolvedEnv = mcp.env
        ? this.capabilityManager.interpolateEnv(mcp.env as Record<string, string>, {
            sessionId, agentId, workspacePath
          })
        : {};

      if (mcp.transport === 'stdio') {
        settings.mcpServers[mcp.name] = {
          command: mcp.command!,
          args: (mcp.args as string[]) ?? [],
          env: resolvedEnv
        };
      } else {
        settings.mcpServers[mcp.name] = {
          url: mcp.url!,
          env: resolvedEnv
        };
      }
    }

    for (const skill of capabilities.skills) {
      settings.skills[skill.name] = {
        command: skill.command,
        args: (skill.args as string[]) ?? []
      };
    }

    // 写入临时配置目录（每次执行独立隔离）
    const configDir = path.join(
      os.tmpdir(),
      `claude-cfg-${sessionId}-${Date.now()}`
    );
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'settings.json'),
      JSON.stringify(settings, null, 2)
    );

    return {
      args: ['--config', configDir],
      env: {},
      cleanup: async () => {
        await fs.rm(configDir, { recursive: true, force: true });
      }
    };
  }
}
```

**CliRunnerService 增加注入钩子**

```typescript
// src/agents/services/cli-runner.service.ts（增强部分）

@Injectable()
export class CliRunnerService {
  constructor(
    private readonly claudeConfigAdapter: ClaudeConfigAdapter
    // 后续可注入 CodexConfigAdapter、GeminiConfigAdapter
  ) {}

  async streamGenerateWithCapabilities(
    baseCommand: string,
    cliType: 'claude' | 'codex' | 'gemini',
    agentId: string,
    sessionId: string,
    workspacePath: string,
    options: CliRunnerOptions
  ): Promise<AsyncIterable<string>> {
    // 1. 获取注入配置
    const inject = await this.getInjectConfig(cliType, agentId, sessionId, workspacePath);

    // 2. 拼接最终命令和环境变量
    const finalCommand = `${baseCommand} ${inject.args.join(' ')}`;
    const finalEnv = { ...process.env, ...inject.env };

    try {
      // 3. 执行
      return this.streamGenerate(finalCommand, { ...options, env: finalEnv });
    } finally {
      // 4. 清理临时文件
      await inject.cleanup();
    }
  }

  private async getInjectConfig(
    cliType: string,
    agentId: string,
    sessionId: string,
    workspacePath: string
  ) {
    switch (cliType) {
      case 'claude':
        return this.claudeConfigAdapter.buildInjectArgs(agentId, sessionId, workspacePath);
      // case 'codex': return this.codexConfigAdapter.buildInjectArgs(...)
      // case 'gemini': return this.geminiConfigAdapter.buildInjectArgs(...)
      default:
        return { args: [], env: {}, cleanup: async () => {} };
    }
  }
}
```

#### 管理 API

**开发者注册内置 MCP（系统启动时）**

```typescript
// src/agents/bootstrap/register-builtin-capabilities.ts

export async function registerBuiltinCapabilities(
  mcpRepo: Repository<McpServerRegistration>,
  skillRepo: Repository<SkillRegistration>
) {
  // 全局 MCP：工作区文件访问
  await mcpRepo.upsert({
    scope: 'global',
    cliTypes: ['claude', 'codex', 'gemini'],
    name: 'workspace',
    displayName: '工作区文件系统',
    description: '允许 Agent 读写当前会话的工作区文件',
    transport: 'stdio',
    command: 'node',
    args: [path.resolve(__dirname, '../../mcp-servers/workspace.mcp.js')],
    env: {
      SESSION_ID: '${SESSION_ID}',
      WORKSPACE_PATH: '${WORKSPACE_PATH}'
    },
    createdBy: 'system'
  }, ['scope', 'name']);

  // 全局 MCP：数据库只读查询（仅 Claude）
  await mcpRepo.upsert({
    scope: 'global',
    cliTypes: ['claude'],
    name: 'db-readonly',
    displayName: '数据库只读查询',
    description: '允许 Agent 查询会话历史、Agent 状态等',
    transport: 'stdio',
    command: 'node',
    args: [path.resolve(__dirname, '../../mcp-servers/db-readonly.mcp.js')],
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      SESSION_ID: '${SESSION_ID}'
    },
    createdBy: 'system'
  }, ['scope', 'name']);

  // 全局 Skill：同步工作区
  await skillRepo.upsert({
    scope: 'global',
    cliTypes: ['claude'],
    name: 'sync-workspace',
    displayName: '同步工作区',
    description: '将本地工作区变更同步到远程存储',
    command: 'node',
    args: [path.resolve(__dirname, '../../skills/sync-workspace.js')],
    createdBy: 'system'
  }, ['scope', 'name']);
}
```

**用户通过 API 为会话挂载自定义 MCP**

```typescript
// src/agents/controllers/mcp-registration.controller.ts

@Controller('sessions/:sessionId/mcp')
export class McpRegistrationController {
  constructor(
    @InjectRepository(McpServerRegistration)
    private readonly mcpRepo: Repository<McpServerRegistration>
  ) {}

  @Post()
  async registerMcp(
    @Param('sessionId') sessionId: string,
    @Body() dto: RegisterMcpDto,
    @CurrentUser() user: User
  ) {
    // 验证用户有权操作该会话
    await this.sessionGuard.assertOwner(sessionId, user.id);

    return this.mcpRepo.save({
      scope: 'session',
      scopeId: sessionId,
      cliTypes: dto.cliTypes ?? ['claude'],
      name: dto.name,
      displayName: dto.displayName,
      description: dto.description,
      transport: dto.transport,
      command: dto.command,
      args: dto.args,
      url: dto.url,
      env: dto.env,
      createdBy: user.id
    });
  }

  @Get()
  async listMcp(@Param('sessionId') sessionId: string) {
    return this.mcpRepo.find({
      where: { scope: 'session', scopeId: sessionId }
    });
  }

  @Delete(':id')
  async removeMcp(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string
  ) {
    await this.mcpRepo.delete({ id, scope: 'session', scopeId: sessionId });
  }
}
```

#### 内置 MCP 服务器实现

这是我们需要自己实现的部分——**暴露系统内部能力给 CLI 工具**。

**工作区 MCP（workspace.mcp.ts）**

```typescript
// src/mcp-servers/workspace.mcp.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const sessionId = process.env.SESSION_ID!;
const workspacePath = process.env.WORKSPACE_PATH!;

const server = new Server({ name: 'workspace', version: '1.0.0' }, {
  capabilities: { tools: {} }
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_workspace_files',
      description: '列出工作区文件树',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '子目录路径，默认为根目录', default: '.' }
        }
      }
    },
    {
      name: 'get_session_context',
      description: '获取当前会话的上下文信息（参与的 Agent、最近消息摘要等）',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === 'list_workspace_files') {
    const targetPath = path.join(workspacePath, args?.path ?? '.');
    const tree = await buildFileTree(targetPath);
    return { content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }] };
  }

  if (name === 'get_session_context') {
    const context = await fetchSessionContext(sessionId);
    return { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

#### 配置文件（开发者视角）

```json
// config/capabilities.config.json
// 开发者在这里声明系统内置的 MCP 和 Skills，无需修改代码

{
  "mcpServers": [
    {
      "scope": "global",
      "cliTypes": ["claude", "codex", "gemini"],
      "name": "workspace",
      "displayName": "工作区文件系统",
      "transport": "stdio",
      "command": "node",
      "args": ["dist/mcp-servers/workspace.mcp.js"],
      "env": {
        "SESSION_ID": "${SESSION_ID}",
        "WORKSPACE_PATH": "${WORKSPACE_PATH}"
      }
    },
    {
      "scope": "global",
      "cliTypes": ["claude"],
      "name": "db-readonly",
      "displayName": "数据库只读查询",
      "transport": "stdio",
      "command": "node",
      "args": ["dist/mcp-servers/db-readonly.mcp.js"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}",
        "SESSION_ID": "${SESSION_ID}"
      }
    }
  ],
  "skills": [
    {
      "scope": "global",
      "cliTypes": ["claude"],
      "name": "sync-workspace",
      "displayName": "同步工作区到远程",
      "command": "node",
      "args": ["dist/skills/sync-workspace.js"]
    }
  ]
}
```

#### 执行流程总结

```
用户发送消息 → Agent 被触发
    ↓
CliRunnerService.streamGenerateWithCapabilities()
    ↓
CliCapabilityManager.resolveCapabilities(cliType, agentId, sessionId)
    ↓ 查询数据库，合并三层配置
ClaudeConfigAdapter.buildInjectArgs()
    ↓ 生成临时 settings.json，写入 /tmp/claude-cfg-{sessionId}-{ts}/
CLI 子进程启动：claude --config /tmp/claude-cfg-xxx/ "..."
    ↓ Claude Code 自动连接 MCP 服务器，加载 Skills
Agent 执行任务，可调用 MCP 工具（list_workspace_files 等）
    ↓
执行完成，清理临时配置目录
```

#### 可观测性

```sql
-- 记录每次 CLI 启动时注入的能力快照，便于调试
CREATE TABLE cli_capability_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  agent_id VARCHAR(50) NOT NULL,
  cli_type VARCHAR(20) NOT NULL,
  injected_mcp_servers JSONB NOT NULL,  -- 实际注入的 MCP 列表
  injected_skills JSONB NOT NULL,       -- 实际注入的 Skills 列表
  config_path TEXT,                     -- 临时配置文件路径（调试用）
  created_at TIMESTAMP DEFAULT NOW()
);
```
