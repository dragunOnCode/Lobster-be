# 考虑点6：CLI工具能力增强机制设计

> 文档版本：v1.0
> 创建日期：2026-03-17
> 作者：Claude Sonnet 4.6

## 目录

1. [看现状](#看现状)
2. [看业界](#看业界)
3. [思考过程](#思考过程)
4. [给方法](#给方法)

---

## 看现状

### 当前实现程度

**已实现：**
- ✅ **CLI集成**：CliRunnerService 支持执行 claude code/codex/gemini cli
- ✅ **流式输出**：支持异步流式执行，实时获取输出
- ✅ **超时控制**：可配置超时时间，强制杀死进程
- ✅ **缓冲区限制**：10MB缓冲区，防止内存溢出
- ✅ **适配器模式**：ILLMAdapter接口，支持CLI和HTTP两种调用方式

**当前缺失：**
- ❌ **MCP集成**：无法使用CLI工具的MCP服务器能力
- ❌ **Skills增强**：无法扩展CLI工具的Skills
- ❌ **工具注册**：无法动态注册自定义工具
- ❌ **上下文注入**：无法向CLI工具注入额外上下文
- ❌ **结果解析**：CLI输出是纯文本，缺少结构化解析

### CLI工具能力

**Claude Code CLI：**
- MCP服务器：可以连接外部MCP服务器（数据库、API等）
- Skills：内置技能系统（/commit, /review-pr等）
- 工具调用：支持function calling
- 上下文管理：自动管理对话历史

**Codex CLI：**
- 代码分析：静态分析、linting
- 代码生成：基于模板生成代码
- 测试运行：执行测试并报告结果

**Gemini CLI：**
- 多模态：支持图片、视频输入
- 长上下文：支持超长上下文窗口
- 代码执行：内置Python代码执行环境

---

## 看业界

### 业界实践案例

#### 1. **LangChain Tools**

```python
from langchain.tools import Tool

def search_tool(query: str) -> str:
    return f"Search results for: {query}"

tools = [
    Tool(
        name="Search",
        func=search_tool,
        description="Useful for searching information"
    )
]

agent = initialize_agent(tools, llm, agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION)
```

**特点：**
- 简单的函数包装
- 自动生成工具描述
- 支持同步和异步

#### 2. **OpenAI Function Calling**

```json
{
  "functions": [
    {
      "name": "get_weather",
      "description": "Get the current weather",
      "parameters": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "The city name"
          }
        },
        "required": ["location"]
      }
    }
  ]
}
```

**特点：**
- JSON Schema定义参数
- LLM自动选择和调用
- 结构化的输入输出

#### 3. **Anthropic MCP (Model Context Protocol)**

```typescript
// MCP服务器
const server = new Server({
  name: "database-mcp",
  version: "1.0.0"
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "query_database",
      description: "Execute SQL query",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string" }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === "query_database") {
    const result = await db.query(args.sql);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
});
```

**特点：**
- 标准化的协议
- 支持工具列表和调用
- 可扩展的架构

#### 4. **AutoGPT Plugins**

```python
class MyPlugin(AutoGPTPluginTemplate):
    def __init__(self):
        super().__init__()
        self._name = "MyPlugin"
        self._version = "0.1.0"
        self._description = "My custom plugin"

    def can_handle_post_prompt(self) -> bool:
        return True

    def post_prompt(self, prompt: PromptGenerator) -> PromptGenerator:
        prompt.add_command(
            "my_command",
            "My Command Description",
            {"arg1": "<arg1>"},
            self.my_command
        )
        return prompt

    def my_command(self, arg1: str) -> str:
        return f"Result: {arg1}"
```

**特点：**
- 插件化架构
- 生命周期钩子
- 命令注册机制

#### 5. **LangGraph Tools**

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const weatherTool = tool(
  async ({ location }) => {
    return `Weather in ${location}: Sunny, 25°C`;
  },
  {
    name: "get_weather",
    description: "Get weather for a location",
    schema: z.object({
      location: z.string().describe("City name")
    })
  }
);

// 在图中使用
const graph = new StateGraph({...});
graph.addNode("agent", async (state) => {
  return await model.invoke(state.messages, {
    tools: [weatherTool]
  });
});
```

**特点：**
- TypeScript类型安全
- Zod schema验证
- 与LangGraph无缝集成

---

## 思考过程

### 信息启发

CLI工具的能力增强有两个方向：
1. **向内增强**：在我们的系统中扩展CLI工具的能力
2. **向外增强**：利用CLI工具自身的扩展机制（MCP、Skills）

### 我们的场景特点

1. **CLI工具是黑盒**：我们无法修改CLI工具的内部实现
2. **需要标准化**：不同CLI工具有不同的接口，需要统一
3. **需要可扩展**：用户可能需要添加自定义工具
4. **需要可组合**：工具之间可以组合使用

### 方案抉择

| 方案 | 优势 | 劣势 | 适用性 |
|------|------|------|--------|
| **包装CLI** | 简单、不侵入 | 功能受限 | ✅ 当前方案 |
| **MCP集成** | 标准化、强大 | 需要MCP服务器 | ✅ 推荐 |
| **自定义工具** | 灵活、可控 | 需要开发 | ✅ 补充 |
| **混合方案** | 全面覆盖 | 复杂度高 | ✅ 最终方案 |

### 最终选择

**三层工具架构：CLI工具 + MCP服务器 + 自定义工具**

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: CLI工具（claude code/codex/gemini）                 │
│  - 使用CLI工具的原生能力                                      │
│  - 通过命令行参数传递配置                                     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: MCP服务器（扩展CLI工具能力）                        │
│  - 数据库MCP：查询数据库                                      │
│  - API MCP：调用外部API                                       │
│  - 文件系统MCP：高级文件操作                                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: 自定义工具（系统特定能力）                          │
│  - 工作区同步工具                                             │
│  - Agent协作工具                                              │
│  - 思考追溯工具                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 给方法

### 方案设计：三层工具架构

#### Layer 1: CLI工具增强

**配置文件注入**

```typescript
// src/agents/services/cli-config.service.ts

@Injectable()
export class CliConfigService {
  /**
   * 生成Claude Code配置文件
   */
  async generateClaudeConfig(sessionId: string, agentId: string): Promise<string> {
    const configDir = path.join(os.tmpdir(), `claude-config-${sessionId}`);
    await fs.mkdir(configDir, { recursive: true });

    const config = {
      // MCP服务器配置
      mcpServers: {
        database: {
          command: "node",
          args: [path.join(__dirname, "../mcp-servers/database.js")],
          env: {
            DATABASE_URL: process.env.DATABASE_URL,
            SESSION_ID: sessionId
          }
        },
        workspace: {
          command: "node",
          args: [path.join(__dirname, "../mcp-servers/workspace.js")],
          env: {
            SESSION_ID: sessionId,
            AGENT_ID: agentId
          }
        }
      },

      // 自定义Skills
      skills: {
        "sync-workspace": {
          command: "node",
          args: [path.join(__dirname, "../skills/sync-workspace.js")]
        }
      },

      // 其他配置
      settings: {
        autoSave: true,
        theme: "dark",
        model: "claude-sonnet-4-6"
      }
    };

    const configPath = path.join(configDir, "config.json");
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return configPath;
  }

  /**
   * 执行CLI时注入配置
   */
  async executeWithConfig(
    command: string,
    sessionId: string,
    agentId: string
  ): Promise<string> {
    const configPath = await this.generateClaudeConfig(sessionId, agentId);

    // 设置环境变量指向配置文件
    const env = {
      ...process.env,
      CLAUDE_CONFIG_PATH: configPath
    };

    return this.cliRunner.execute(command, { env });
  }
}
```

#### Layer 2: MCP服务器实现

**数据库MCP服务器**

```typescript
// src/mcp-servers/database.mcp.ts

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "database-mcp",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// 列出可用工具
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "query_messages",
      description: "Query messages from the database",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "Session ID"
          },
          limit: {
            type: "number",
            description: "Number of messages to return",
            default: 10
          }
        },
        required: ["sessionId"]
      }
    },
    {
      name: "get_agent_info",
      description: "Get information about an agent",
      inputSchema: {
        type: "object",
        properties: {
          agentId: {
            type: "string",
            description: "Agent ID"
          }
        },
        required: ["agentId"]
      }
    }
  ]
}));

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "query_messages": {
      const messages = await queryMessages(args.sessionId, args.limit || 10);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(messages, null, 2)
          }
        ]
      };
    }

    case "get_agent_info": {
      const agent = await getAgentInfo(args.agentId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(agent, null, 2)
          }
        ]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Database MCP server running on stdio");
}

main().catch(console.error);

// 辅助函数
async function queryMessages(sessionId: string, limit: number) {
  // 连接数据库并查询
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const result = await pool.query(
    `SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [sessionId, limit]
  );
  await pool.end();
  return result.rows;
}

async function getAgentInfo(agentId: string) {
  // 从配置文件读取Agent信息
  const config = JSON.parse(
    await fs.readFile("config/agents.config.json", "utf-8")
  );
  return config.agents.find((a: any) => a.id === agentId);
}
```

**工作区MCP服务器**

```typescript
// src/mcp-servers/workspace.mcp.ts

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_files",
      description: "List all files in the workspace",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path (relative to workspace root)",
            default: "."
          }
        }
      }
    },
    {
      name: "read_file",
      description: "Read file content",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path"
          }
        },
        required: ["path"]
      }
    },
    {
      name: "write_file",
      description: "Write content to file",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path"
          },
          content: {
            type: "string",
            description: "File content"
          }
        },
        required: ["path", "content"]
      }
    },
    {
      name: "sync_workspace",
      description: "Sync workspace with remote storage",
      inputSchema: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["upload", "download"],
            description: "Sync direction"
          }
        },
        required: ["direction"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const sessionId = process.env.SESSION_ID!;

  switch (name) {
    case "list_files": {
      const files = await workspaceSyncService.getFileList(sessionId, args.path || ".");
      return {
        content: [{ type: "text", text: JSON.stringify(files, null, 2) }]
      };
    }

    case "read_file": {
      const content = await workspaceSyncService.readFile(sessionId, args.path);
      return {
        content: [{ type: "text", text: content }]
      };
    }

    case "write_file": {
      await workspaceSyncService.writeFile(sessionId, args.path, args.content);
      return {
        content: [{ type: "text", text: "File written successfully" }]
      };
    }

    case "sync_workspace": {
      if (args.direction === "upload") {
        await workspaceSyncService.uploadChanges(sessionId, "./", agentId, machineId);
      } else {
        await workspaceSyncService.downloadWorkspace(sessionId, "./");
      }
      return {
        content: [{ type: "text", text: `Workspace synced (${args.direction})` }]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});
```

#### Layer 3: 自定义工具注册

**工具注册表**

```typescript
// src/agents/services/tool-registry.service.ts

export interface CustomTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (args: any, context: ToolContext) => Promise<any>;
}

export interface ToolContext {
  sessionId: string;
  agentId: string;
  userId?: string;
}

@Injectable()
export class ToolRegistryService {
  private tools = new Map<string, CustomTool>();

  /**
   * 注册自定义工具
   */
  registerTool(tool: CustomTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 获取所有工具
   */
  getAllTools(): CustomTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 执行工具
   */
  async executeTool(
    name: string,
    args: any,
    context: ToolContext
  ): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    return tool.handler(args, context);
  }

  /**
   * 生成工具描述（用于Prompt）
   */
  generateToolDescriptions(): string {
    return this.getAllTools()
      .map(tool => {
        return `
## ${tool.name}
${tool.description}

Parameters:
${JSON.stringify(tool.inputSchema, null, 2)}
`;
      })
      .join("\n");
  }
}
```

**内置工具定义**

```typescript
// src/agents/tools/builtin-tools.ts

export function registerBuiltinTools(registry: ToolRegistryService) {
  // 工具1：查询会话历史
  registry.registerTool({
    name: "query_session_history",
    description: "Query conversation history for the current session",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of messages to return",
          default: 10
        },
        role: {
          type: "string",
          enum: ["user", "assistant", "system"],
          description: "Filter by message role"
        }
      }
    },
    handler: async (args, context) => {
      const messages = await messageRepository.find({
        where: {
          sessionId: context.sessionId,
          ...(args.role && { role: args.role })
        },
        order: { createdAt: "DESC" },
        take: args.limit || 10
      });
      return messages;
    }
  });

  // 工具2：获取其他Agent的状态
  registry.registerTool({
    name: "get_agent_status",
    description: "Get the current status of another agent",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Agent ID"
        }
      },
      required: ["agentId"]
    },
    handler: async (args, context) => {
      const agent = await agentRegistry.getAgent(args.agentId);
      const recentTasks = await agentTaskRepository.find({
        where: {
          assignedAgentId: args.agentId,
          sessionId: context.sessionId
        },
        order: { createdAt: "DESC" },
        take: 5
      });
      return {
        agent: {
          id: agent.id,
          name: agent.name,
          type: agent.type,
          status: agent.status
        },
        recentTasks: recentTasks.map(t => ({
          id: t.id,
          description: t.taskDescription,
          status: t.status
        }))
      };
    }
  });

  // 工具3：创建握手任务
  registry.registerTool({
    name: "handoff_to_agent",
    description: "Hand off the current task to another agent",
    inputSchema: {
      type: "object",
      properties: {
        targetAgentId: {
          type: "string",
          description: "Target agent ID"
        },
        reason: {
          type: "string",
          description: "Reason for handoff"
        },
        context: {
          type: "object",
          description: "Additional context to pass"
        }
      },
      required: ["targetAgentId", "reason"]
    },
    handler: async (args, context) => {
      const handoffTask = await handoffService.createHandoffTask({
        sessionId: context.sessionId,
        sourceAgentId: context.agentId,
        targetAgentId: args.targetAgentId,
        reason: args.reason,
        context: args.context
      });
      return {
        success: true,
        taskId: handoffTask.id
      };
    }
  });

  // 工具4：查询思考轨迹
  registry.registerTool({
    name: "query_thought_trace",
    description: "Query the thought trace for a specific task or message",
    inputSchema: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "Message ID"
        },
        taskId: {
          type: "string",
          description: "Task ID"
        }
      }
    },
    handler: async (args, context) => {
      if (args.messageId) {
        return thoughtQueryService.getThoughtChain(args.messageId);
      } else if (args.taskId) {
        return thoughtQueryService.getTraceForTask(args.taskId);
      }
      throw new Error("Either messageId or taskId must be provided");
    }
  });
}
```

#### 工具调用流程

**在Prompt中注入工具描述**

```typescript
// src/agents/services/prompt-builder.service.ts

@Injectable()
export class PromptBuilderService {
  constructor(
    private readonly toolRegistry: ToolRegistryService
  ) {}

  buildPromptWithTools(
    basePrompt: string,
    context: ToolContext
  ): string {
    const toolDescriptions = this.toolRegistry.generateToolDescriptions();

    return `
${basePrompt}

# Available Tools

You have access to the following tools:

${toolDescriptions}

To use a tool, output:

TOOL_CALL: {
  "name": "tool_name",
  "arguments": {
    "arg1": "value1"
  }
}

The tool result will be provided in the next message.
`;
  }
}
```

**解析和执行工具调用**

```typescript
// src/agents/services/tool-executor.service.ts

@Injectable()
export class ToolExecutorService {
  constructor(
    private readonly toolRegistry: ToolRegistryService
  ) {}

  /**
   * 从Agent响应中提取工具调用
   */
  extractToolCalls(content: string): ToolCall[] {
    const toolCallRegex = /TOOL_CALL:\s*(\{[\s\S]*?\})/g;
    const calls: ToolCall[] = [];

    let match;
    while ((match = toolCallRegex.exec(content)) !== null) {
      try {
        const call = JSON.parse(match[1]);
        calls.push(call);
      } catch (e) {
        console.error("Failed to parse tool call:", match[1]);
      }
    }

    return calls;
  }

  /**
   * 执行所有工具调用
   */
  async executeToolCalls(
    calls: ToolCall[],
    context: ToolContext
  ): Promise<ToolResult[]> {
    return Promise.all(
      calls.map(async (call) => {
        try {
          const result = await this.toolRegistry.executeTool(
            call.name,
            call.arguments,
            context
          );
          return {
            toolName: call.name,
            success: true,
            result
          };
        } catch (error) {
          return {
            toolName: call.name,
            success: false,
            error: error.message
          };
        }
      })
    );
  }

  /**
   * 格式化工具结果为文本
   */
  formatToolResults(results: ToolResult[]): string {
    return results
      .map(r => {
        if (r.success) {
          return `
TOOL_RESULT (${r.toolName}):
${JSON.stringify(r.result, null, 2)}
`;
        } else {
          return `
TOOL_ERROR (${r.toolName}):
${r.error}
`;
        }
      })
      .join("\n");
  }
}
```

#### 集成到ReAct循环

```typescript
// src/langgraph/nodes/react-with-tools.node.ts

async function thinkNode(state: ReactState) {
  const agent = await agentRegistry.getAgent(state.agentId);

  // 构建带工具的Prompt
  const prompt = promptBuilder.buildPromptWithTools(
    buildBasePrompt(state),
    {
      sessionId: state.sessionId,
      agentId: state.agentId
    }
  );

  const response = await agent.invoke(prompt);

  // 提取工具调用
  const toolCalls = toolExecutor.extractToolCalls(response.content);

  if (toolCalls.length > 0) {
    // 执行工具
    const toolResults = await toolExecutor.executeToolCalls(toolCalls, {
      sessionId: state.sessionId,
      agentId: state.agentId
    });

    // 将工具结果添加到上下文
    const toolResultText = toolExecutor.formatToolResults(toolResults);

    // 再次调用Agent，让它处理工具结果
    const followUpPrompt = `
${response.content}

${toolResultText}

Please continue based on the tool results.
`;

    const followUpResponse = await agent.invoke(followUpPrompt);

    return {
      reactSteps: [
        {
          type: "think",
          content: response.content,
          toolCalls,
          toolResults
        },
        {
          type: "think",
          content: followUpResponse.content
        }
      ]
    };
  }

  return {
    reactSteps: [
      {
        type: "think",
        content: response.content
      }
    ]
  };
}
```

#### 配置管理

```json
// config/tools.config.json
{
  "mcpServers": {
    "database": {
      "enabled": true,
      "command": "node",
      "args": ["dist/mcp-servers/database.mcp.js"]
    },
    "workspace": {
      "enabled": true,
      "command": "node",
      "args": ["dist/mcp-servers/workspace.mcp.js"]
    }
  },
  "customTools": {
    "query_session_history": { "enabled": true },
    "get_agent_status": { "enabled": true },
    "handoff_to_agent": { "enabled": true },
    "query_thought_trace": { "enabled": true }
  },
  "toolCallTimeout": 30000,
  "maxToolCallsPerTurn": 10
}
```

#### 监控和日志

```typescript
// 记录工具调用
await toolCallLogRepository.save({
  sessionId: context.sessionId,
  agentId: context.agentId,
  toolName: call.name,
  arguments: call.arguments,
  result: result,
  success: true,
  durationMs: Date.now() - startTime
});

// 统计工具使用情况
const stats = await toolCallLogRepository
  .createQueryBuilder("log")
  .select("log.tool_name", "toolName")
  .addSelect("COUNT(*)", "count")
  .addSelect("AVG(log.duration_ms)", "avgDuration")
  .where("log.session_id = :sessionId", { sessionId })
  .groupBy("log.tool_name")
  .getRawMany();
```
