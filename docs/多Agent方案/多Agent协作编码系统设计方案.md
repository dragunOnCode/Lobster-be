# 多Agent协作编码系统设计方案

> 文档版本：v1.0
> 创建日期：2026-03-17
> 作者：Claude Sonnet 4.6

## 目录

1. [考虑点1：工作区代码输出与交付机制](#考虑点1工作区代码输出与交付机制)
2. [考虑点2：Multi Agent协作流程设计](#考虑点2multi-agent协作流程设计)
3. [考虑点3：分布式环境下的A2A协作](#考虑点3分布式环境下的a2a协作)
4. [考虑点4：思考过程展示与追溯](#考虑点4思考过程展示与追溯)
5. [考虑点5：Agent思考范式与LangGraph增强](#考虑点5agent思考范式与langgraph增强)
6. [考虑点6：CLI工具能力增强机制](#考虑点6cli工具能力增强机制)

---

## 考虑点1：工作区代码输出与交付机制

### 1.1 看现状

**当前实现程度：**

根据项目探索，当前系统已实现：

- **工作区管理服务** (`workspace.service.ts`)：
  - 基于文件系统的工作区，每个会话对应独立目录结构
  - 目录结构：`{WORKSPACE_ROOT}/{sessionId}/code/`、`docs/`、`metadata.json`、`transcripts.jsonl`
  - 支持会话初始化、重命名、删除操作
  - 事件追踪：所有操作记录为JSONL格式

- **CLI工具集成** (`cli-runner.service.ts`)：
  - 支持同步和异步流式执行
  - 子进程管理、超时控制、缓冲区限制(10MB)
  - CLI工具在`workspace/{sessionId}/`目录下执行代码编辑

**当前缺失：**
- ❌ 没有代码打包和下载机制
- ❌ 没有增量代码同步机制
- ❌ 没有代码版本管理和回滚能力
- ❌ 前端无法实时预览工作区文件变更

### 1.2 看业界

**业界实践案例：**

1. **GitHub Codespaces / Gitpod**
   - 基于容器的云端开发环境
   - 实时文件同步：通过WebSocket推送文件变更事件
   - 代码预览：内置Web服务器，支持端口转发
   - 导出机制：Git提交 + 远程仓库推送

2. **Replit / StackBlitz**
   - 浏览器内IDE，使用WebContainers技术
   - 虚拟文件系统：基于内存的FS API，通过postMessage同步到前端
   - 实时预览：iframe沙箱 + Service Worker拦截
   - 导出方式：ZIP下载、GitHub导出、npm发布

3. **Cursor / Continue.dev**
   - 本地IDE插件，AI辅助编码
   - 文件监听：使用文件系统watcher (chokidar)
   - Diff展示：Monaco Editor的diff viewer
   - 无需导出：直接操作本地文件系统

4. **Vercel v0 / Bolt.new**
   - AI生成代码 + 即时部署
   - 代码生成：流式返回代码块，前端实时渲染
   - 预览机制：自动部署到临时环境
   - 导出方式：下载ZIP、克隆到GitHub、部署到Vercel

### 1.3 思考过程

**信息启发：**

从业界案例可以看出，代码交付机制的核心矛盾是：**CLI工具在后端文件系统操作 vs 用户在前端浏览器查看**。

**方案抉择的关键维度：**

| 维度 | 选项A：打包下载 | 选项B：实时同步 | 选项C：混合模式 |
|------|----------------|----------------|----------------|
| **实时性** | ❌ 低（需手动触发） | ✅ 高（毫秒级） | ✅ 高 |
| **带宽消耗** | ✅ 低（按需） | ❌ 高（持续） | ⚠️ 中等 |
| **实现复杂度** | ✅ 简单 | ❌ 复杂 | ⚠️ 中等 |
| **用户体验** | ❌ 差（需等待） | ✅ 好（即时反馈） | ✅ 好 |
| **离线能力** | ✅ 支持 | ❌ 不支持 | ✅ 支持 |
| **版本管理** | ✅ 天然支持 | ⚠️ 需额外实现 | ✅ 支持 |

**取舍标准：**

1. **用户体验优先**：AI编码的核心价值是"所见即所得"，实时反馈比离线能力更重要
2. **渐进式增强**：先实现基础的实时同步，再叠加打包下载作为补充
3. **性能可控**：使用增量同步 + 防抖策略，避免带宽浪费
4. **兼容现有架构**：复用WebSocket通道，最小化改动

### 1.4 给方法

**方案设计：混合模式 - 实时同步 + 按需打包**

#### 方案架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (Web)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Monaco Editor│  │  文件树组件  │  │  下载按钮    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │ WebSocket        │ WebSocket        │ HTTP
          │ (file_change)    │ (file_tree)      │ (download)
┌─────────┼──────────────────┼──────────────────┼──────────────┐
│         ↓                  ↓                  ↓              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         LangGraphEventBridgeService                   │   │
│  │  - 监听workspace文件变更事件                          │   │
│  │  - 转换为WebSocket消息推送                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         WorkspaceService (增强)                       │   │
│  │  - watchFiles(): 文件监听 (chokidar)                 │   │
│  │  - getFileTree(): 获取目录树                          │   │
│  │  - getFileDiff(): 获取文件diff                        │   │
│  │  - packageWorkspace(): 打包为ZIP                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         CliRunnerService (增强)                       │   │
│  │  - 执行前：快照当前文件状态                           │   │
│  │  - 执行后：对比变更，发送file_change事件              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  文件系统: workspace/{sessionId}/code/                      │
└──────────────────────────────────────────────────────────────┘
```

#### 实现步骤

**Step 1: 增强WorkspaceService**

新增方法：

```typescript
// src/workspace/workspace.service.ts

import * as chokidar from 'chokidar';
import * as archiver from 'archiver';

export class WorkspaceService {
  private watchers = new Map<string, chokidar.FSWatcher>();

  /**
   * 监听工作区文件变更
   */
  async watchFiles(
    sessionId: string,
    callback: (event: FileChangeEvent) => void
  ): Promise<void> {
    const workspacePath = this.getWorkspacePath(sessionId);
    const codePath = path.join(workspacePath, 'code');

    const watcher = chokidar.watch(codePath, {
      ignored: /(^|[\/\\])\../, // 忽略隐藏文件
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300, // 防抖300ms
        pollInterval: 100
      }
    });

    watcher
      .on('add', (filePath) => callback({ type: 'add', path: filePath }))
      .on('change', (filePath) => callback({ type: 'change', path: filePath }))
      .on('unlink', (filePath) => callback({ type: 'delete', path: filePath }));

    this.watchers.set(sessionId, watcher);
  }

  /**
   * 停止监听
   */
  async unwatchFiles(sessionId: string): Promise<void> {
    const watcher = this.watchers.get(sessionId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(sessionId);
    }
  }

  /**
   * 获取文件树
   */
  async getFileTree(sessionId: string): Promise<FileNode> {
    const codePath = path.join(this.getWorkspacePath(sessionId), 'code');
    return this.buildFileTree(codePath);
  }

  private async buildFileTree(dirPath: string): Promise<FileNode> {
    const stats = await fs.stat(dirPath);
    const name = path.basename(dirPath);

    if (stats.isFile()) {
      return {
        name,
        type: 'file',
        path: dirPath,
        size: stats.size,
        modifiedAt: stats.mtime
      };
    }

    const children = await fs.readdir(dirPath);
    const childNodes = await Promise.all(
      children.map(child => this.buildFileTree(path.join(dirPath, child)))
    );

    return {
      name,
      type: 'directory',
      path: dirPath,
      children: childNodes
    };
  }

  /**
   * 打包工作区为ZIP
   */
  async packageWorkspace(sessionId: string): Promise<Buffer> {
    const codePath = path.join(this.getWorkspacePath(sessionId), 'code');

    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on('data', (chunk) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      archive.directory(codePath, false);
      archive.finalize();
    });
  }

  /**
   * 获取文件内容和diff
   */
  async getFileDiff(
    sessionId: string,
    filePath: string,
    baseVersion?: string
  ): Promise<FileDiff> {
    const fullPath = path.join(
      this.getWorkspacePath(sessionId),
      'code',
      filePath
    );
    const currentContent = await fs.readFile(fullPath, 'utf-8');

    if (!baseVersion) {
      return {
        path: filePath,
        content: currentContent,
        diff: null
      };
    }

    // 使用diff库计算差异
    const diff = Diff.createPatch(
      filePath,
      baseVersion,
      currentContent,
      'base',
      'current'
    );

    return {
      path: filePath,
      content: currentContent,
      diff
    };
  }
}
```

**Step 2: 增强LangGraphEventBridgeService**

新增文件变更事件转发：

```typescript
// src/gateway/services/langgraph-event-bridge.service.ts

export class LangGraphEventBridgeService {
  /**
   * 订阅工作区文件变更
   */
  async subscribeWorkspaceChanges(sessionId: string): Promise<void> {
    await this.workspaceService.watchFiles(sessionId, async (event) => {
      const relativePath = path.relative(
        path.join(this.workspaceService.getWorkspacePath(sessionId), 'code'),
        event.path
      );

      let content: string | null = null;
      if (event.type !== 'delete') {
        content = await fs.readFile(event.path, 'utf-8');
      }

      // 推送到前端
      this.chatGateway.server
        .to(`session:${sessionId}`)
        .emit('workspace:file_change', {
          sessionId,
          event: {
            type: event.type,
            path: relativePath,
            content,
            timestamp: new Date().toISOString()
          }
        });
    });
  }

  /**
   * 取消订阅
   */
  async unsubscribeWorkspaceChanges(sessionId: string): Promise<void> {
    await this.workspaceService.unwatchFiles(sessionId);
  }
}
```

**Step 3: 新增WorkspaceController**

提供HTTP接口用于下载和查询：

```typescript
// src/workspace/workspace.controller.ts

@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get(':sessionId/tree')
  async getFileTree(@Param('sessionId') sessionId: string) {
    return this.workspaceService.getFileTree(sessionId);
  }

  @Get(':sessionId/download')
  async downloadWorkspace(
    @Param('sessionId') sessionId: string,
    @Res() res: Response
  ) {
    const zipBuffer = await this.workspaceService.packageWorkspace(sessionId);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="workspace-${sessionId}.zip"`,
      'Content-Length': zipBuffer.length
    });

    res.send(zipBuffer);
  }

  @Get(':sessionId/file')
  async getFile(
    @Param('sessionId') sessionId: string,
    @Query('path') filePath: string
  ) {
    return this.workspaceService.getFileDiff(sessionId, filePath);
  }
}
```

**Step 4: 前端集成示例**

```typescript
// 前端代码示例

class WorkspaceClient {
  private socket: Socket;
  private fileCache = new Map<string, string>();

  constructor(sessionId: string) {
    this.socket = io('/chat');
    this.socket.emit('join_session', { sessionId });

    // 监听文件变更
    this.socket.on('workspace:file_change', (data) => {
      this.handleFileChange(data.event);
    });
  }

  private handleFileChange(event: FileChangeEvent) {
    switch (event.type) {
      case 'add':
      case 'change':
        this.fileCache.set(event.path, event.content);
        this.updateEditor(event.path, event.content);
        break;
      case 'delete':
        this.fileCache.delete(event.path);
        this.removeFromFileTree(event.path);
        break;
    }
  }

  async downloadWorkspace(sessionId: string) {
    const response = await fetch(`/api/workspace/${sessionId}/download`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `workspace-${sessionId}.zip`;
    a.click();
  }
}
```

#### 性能优化策略

1. **增量同步**：
   - 只推送变更的文件，不推送整个工作区
   - 使用diff算法，只传输变更的行

2. **防抖策略**：
   - chokidar的`awaitWriteFinish`配置，避免频繁触发
   - 前端使用debounce，合并短时间内的多次更新

3. **压缩传输**：
   - WebSocket启用压缩（permessage-deflate）
   - 大文件使用gzip压缩后传输

4. **智能过滤**：
   - 忽略`node_modules`、`.git`等大型目录
   - 忽略二进制文件（图片、视频等）
   - 配置`.workspaceignore`文件

5. **懒加载**：
   - 初始只加载文件树结构，不加载内容
   - 用户打开文件时才请求内容

#### 数据库扩展

新增表：`workspace_snapshots`

```sql
CREATE TABLE workspace_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  snapshot_type VARCHAR(20) NOT NULL, -- 'auto' | 'manual' | 'agent_task'
  file_tree JSONB NOT NULL,
  created_by VARCHAR(50), -- agent_id or 'user'
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX idx_workspace_snapshots_session ON workspace_snapshots(session_id, created_at DESC);
```

用途：
- 每次Agent任务完成后自动创建快照
- 支持版本回滚
- 用于分布式环境的状态同步（见考虑点3）

---

## 考虑点2：Multi Agent协作流程设计

### 2.1 看现状

**当前实现程度：**

根据项目探索，当前系统已实现：

- **LangGraph编排** (`free-chat.graph.ts`)：
  - 三节点DAG：`hydrate_session_state` → `route_current_message` → `run_next_task`
  - 支持检查点保存和恢复
  - 流式事件推送

- **握手转移机制** (`agent-handoff.service.ts`)：
  - 支持@提及和结构化握手块`[HANDOFF]`
  - 自动解析目标Agent
  - 防止重复握手（任务指纹）

- **决策引擎** (`decision-engine.service.ts`)：
  - 并行决策所有Agent是否响应
  - 优先级排序
  - 超时控制（3秒）

- **任务队列**：
  - `ChatGraphTask`：包含agentId、triggerMessageId、depth、sourceAgentId
  - 最大握手深度限制（4层）
  - 最大Agent轮数限制（8轮）

**当前缺失：**
- ❌ 没有Agent的"思考->规划->工作->评估"循环
- ❌ 没有显式的规划步骤（Plan-And-Execute）
- ❌ Agent无法感知其他Agent的能力和状态
- ❌ 缺少工作质量评估和自我修正机制

### 2.2 看业界

**业界实践案例：**

1. **AutoGPT / BabyAGI**
   - 任务分解：将大任务拆解为子任务列表
   - 循环执行：Task → Execute → Evaluate → Next Task
   - 记忆系统：使用向量数据库存储执行历史
   - 问题：容易陷入无限循环，缺少终止条件

2. **LangChain Plan-And-Execute**
   - 两阶段：Planner生成步骤列表 → Executor逐步执行
   - Re-planning：执行失败时重新规划
   - 优势：结构清晰，可追溯
   - 问题：规划和执行分离，缺少动态调整

3. **MetaGPT**
   - 角色分工：ProductManager、Architect、Engineer、QA
   - 工作流：需求分析 → 架构设计 → 编码 → 测试
   - 文档驱动：每个角色输出结构化文档
   - 优势：模拟真实团队协作，输出质量高
   - 问题：流程固定，灵活性差

4. **CrewAI**
   - 任务编排：Sequential、Parallel、Hierarchical
   - Agent协作：通过共享上下文和工具
   - 回调机制：任务开始/结束/失败的钩子
   - 优势：灵活的编排方式
   - 问题：需要手动定义任务依赖

5. **Microsoft AutoGen**
   - 对话式协作：Agent之间通过消息对话
   - 群聊模式：多个Agent在同一会话中协作
   - 人类参与：支持人类在循环中审批
   - 优势：自然的协作方式，易于理解
   - 问题：对话可能发散，难以控制

### 2.3 思考过程

**信息启发：**

业界方案的核心差异在于**控制流的刚性 vs 灵活性**：
- 刚性流程（MetaGPT）：可预测、高质量，但缺少适应性
- 灵活对话（AutoGen）：适应性强，但容易失控

**我们的场景特点：**
1. 用户只提供高层需求（"实现贪吃蛇游戏"）
2. 需要Agent自主分解任务和规划
3. 多个Agent有不同专长（Claude架构、Codex审查、Gemini设计）
4. 需要在灵活性和可控性之间平衡

**方案抉择：**

| 维度 | 纯对话式 | 固定流程 | ReAct循环 | Plan-And-Execute | 混合模式 |
|------|---------|---------|-----------|-----------------|---------|
| **灵活性** | ✅ 高 | ❌ 低 | ⚠️ 中 | ⚠️ 中 | ✅ 高 |
| **可控性** | ❌ 低 | ✅ 高 | ⚠️ 中 | ✅ 高 | ✅ 高 |
| **可追溯** | ❌ 差 | ✅ 好 | ✅ 好 | ✅ 好 | ✅ 好 |
| **质量保证** | ❌ 差 | ✅ 好 | ⚠️ 中 | ✅ 好 | ✅ 好 |
| **实现复杂度** | ✅ 低 | ⚠️ 中 | ⚠️ 中 | ⚠️ 中 | ❌ 高 |

**取舍标准：**

1. **用户体验优先**：用户不关心内部流程，只关心结果质量
2. **质量保证**：代码质量比速度更重要，需要评估和修正机制
3. **可追溯性**：思考过程需要可视化，便于调试和改进
4. **渐进式实现**：先实现基础的Plan-And-Execute，再叠加ReAct循环

**最终选择：Plan-And-Execute + ReAct混合模式**

理由：
- Plan-And-Execute提供结构化的任务分解
- ReAct循环提供每个步骤的自我修正能力
- 两者结合，既有全局规划，又有局部灵活性

### 2.4 给方法

**方案设计：Plan-And-Execute + ReAct混合模式**

#### 核心流程

```
用户请求 → Planner Agent → 生成任务计划
                              ↓
                         任务队列 (tasks[])
                              ↓
                    ┌─────────┴─────────┐
                    ↓                   ↓
            Executor Agent      Reviewer Agent
                    ↓                   ↓
            ReAct循环执行          质量评估
            (Think→Act→Observe)        ↓
                    ↓              Pass / Fail
                    └─────────┬─────────┘
                              ↓
                    Fail → Re-plan / Retry
                    Pass → Next Task
```

#### 数据库设计

**新增表1：agent_plans**

```sql
CREATE TABLE agent_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  trigger_message_id UUID NOT NULL REFERENCES messages(id),
  planner_agent_id VARCHAR(50) NOT NULL,
  plan_content JSONB NOT NULL, -- { goal, steps[], dependencies }
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | executing | completed | failed
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX idx_agent_plans_session ON agent_plans(session_id, created_at DESC);
CREATE INDEX idx_agent_plans_status ON agent_plans(status);
```

**新增表2：agent_tasks**

```sql
CREATE TABLE agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES agent_plans(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  task_type VARCHAR(50) NOT NULL, -- 'code' | 'review' | 'test' | 'design'
  assigned_agent_id VARCHAR(50) NOT NULL,
  task_description TEXT NOT NULL,
  dependencies UUID[], -- 依赖的其他task_id
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | in_progress | completed | failed | blocked
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  result JSONB, -- 执行结果
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  metadata JSONB
);

CREATE INDEX idx_agent_tasks_plan ON agent_tasks(plan_id, step_index);
CREATE INDEX idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX idx_agent_tasks_dependencies ON agent_tasks USING GIN(dependencies);
```

**新增表3：agent_react_steps**

```sql
CREATE TABLE agent_react_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  step_type VARCHAR(20) NOT NULL, -- 'think' | 'act' | 'observe'
  content TEXT NOT NULL,
  tool_calls JSONB, -- 工具调用记录
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX idx_agent_react_steps_task ON agent_react_steps(task_id, step_index);
```

#### LangGraph图重构

**新的图结构：**

```typescript
// src/chat/graphs/multi-agent-collab.graph.ts

import { StateGraph, END } from '@langchain/langgraph';

interface MultiAgentState {
  sessionId: string;
  currentPlan: AgentPlan | null;
  taskQueue: AgentTask[];
  currentTask: AgentTask | null;
  reactSteps: ReactStep[];
  conversationHistory: Message[];
  workspaceSnapshot: WorkspaceSnapshot;
}

export function createMultiAgentCollabGraph() {
  const graph = new StateGraph<MultiAgentState>({
    channels: {
      sessionId: null,
      currentPlan: null,
      taskQueue: null,
      currentTask: null,
      reactSteps: null,
      conversationHistory: null,
      workspaceSnapshot: null
    }
  });

  // 节点定义
  graph.addNode('hydrate_state', hydrateStateNode);
  graph.addNode('should_plan', shouldPlanNode);
  graph.addNode('create_plan', createPlanNode);
  graph.addNode('select_next_task', selectNextTaskNode);
  graph.addNode('execute_task_react', executeTaskReactNode);
  graph.addNode('review_task', reviewTaskNode);
  graph.addNode('update_plan', updatePlanNode);
  graph.addNode('finalize', finalizeNode);

  // 边定义
  graph.addEdge('__start__', 'hydrate_state');

  graph.addConditionalEdges(
    'hydrate_state',
    (state) => state.currentPlan ? 'select_next_task' : 'should_plan'
  );

  graph.addConditionalEdges(
    'should_plan',
    (state) => state.needsPlanning ? 'create_plan' : 'select_next_task'
  );

  graph.addEdge('create_plan', 'select_next_task');

  graph.addConditionalEdges(
    'select_next_task',
    (state) => {
      if (!state.currentTask) return 'finalize';
      if (state.currentTask.status === 'blocked') return 'update_plan';
      return 'execute_task_react';
    }
  );

  graph.addEdge('execute_task_react', 'review_task');

  graph.addConditionalEdges(
    'review_task',
    (state) => {
      const review = state.currentTask.result?.review;
      if (review?.passed) return 'select_next_task';
      if (state.currentTask.retry_count < state.currentTask.max_retries) {
        return 'execute_task_react'; // 重试
      }
      return 'update_plan'; // 重新规划
    }
  );

  graph.addEdge('update_plan', 'select_next_task');
  graph.addEdge('finalize', END);

  return graph.compile({
    checkpointer: new PostgresSaver(pool) // 使用现有的检查点保存器
  });
}
```

#### 核心节点实现

**节点1：createPlanNode - 规划生成**

```typescript
// src/chat/nodes/create-plan.node.ts

async function createPlanNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
  const plannerAgent = await agentRegistry.getAgent('planner');

  const prompt = `
你是一个任务规划专家。用户的需求是：

${state.conversationHistory.slice(-1)[0].content}

当前工作区状态：
${JSON.stringify(state.workspaceSnapshot.fileTree, null, 2)}

请生成一个详细的执行计划，包括：
1. 任务分解：将需求拆解为可执行的子任务
2. 任务类型：标注每个任务的类型（code/review/test/design）
3. 依赖关系：标注任务之间的依赖
4. Agent分配：为每个任务分配最合适的Agent

输出格式（JSON）：
{
  "goal": "总体目标",
  "steps": [
    {
      "index": 0,
      "type": "code",
      "description": "任务描述",
      "assignedAgent": "agent_id",
      "dependencies": [],
      "estimatedTime": "5min"
    }
  ]
}
`;

  const response = await plannerAgent.invoke(prompt);
  const planData = JSON.parse(response.content);

  // 保存到数据库
  const plan = await agentPlanRepository.create({
    sessionId: state.sessionId,
    triggerMessageId: state.conversationHistory.slice(-1)[0].id,
    plannerAgentId: 'planner',
    planContent: planData,
    status: 'pending'
  });

  // 创建任务
  const tasks = await Promise.all(
    planData.steps.map((step, index) =>
      agentTaskRepository.create({
        planId: plan.id,
        sessionId: state.sessionId,
        stepIndex: index,
        taskType: step.type,
        assignedAgentId: step.assignedAgent,
        taskDescription: step.description,
        dependencies: step.dependencies.map(depIndex =>
          tasks[depIndex]?.id
        ).filter(Boolean),
        status: step.dependencies.length === 0 ? 'pending' : 'blocked'
      })
    )
  );

  return {
    currentPlan: plan,
    taskQueue: tasks
  };
}
```

**节点2：executeTaskReactNode - ReAct循环执行**

```typescript
// src/chat/nodes/execute-task-react.node.ts

async function executeTaskReactNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
  const task = state.currentTask;
  const agent = await agentRegistry.getAgent(task.assignedAgentId);

  const reactSteps: ReactStep[] = [];
  let maxIterations = 10;
  let iteration = 0;
  let taskCompleted = false;

  // 更新任务状态
  await agentTaskRepository.update(task.id, {
    status: 'in_progress',
    startedAt: new Date()
  });

  while (iteration < maxIterations && !taskCompleted) {
    // Step 1: Think
    const thinkPrompt = `
当前任务：${task.taskDescription}

已完成的步骤：
${reactSteps.map((s, i) => `${i + 1}. [${s.step_type}] ${s.content}`).join('\n')}

工作区当前状态：
${await getWorkspaceContext(state.sessionId)}

请思考：
1. 下一步应该做什么？
2. 需要使用哪些工具？
3. 预期的结果是什么？

输出格式：
THOUGHT: [你的思考过程]
ACTION: [要执行的动作] 或 FINISH: [任务完成说明]
`;

    const thinkResponse = await agent.invoke(thinkPrompt);
    const thinkStep = await agentReactStepRepository.create({
      taskId: task.id,
      stepIndex: reactSteps.length,
      stepType: 'think',
      content: thinkResponse.content
    });
    reactSteps.push(thinkStep);

    // 检查是否完成
    if (thinkResponse.content.includes('FINISH:')) {
      taskCompleted = true;
      break;
    }

    // Step 2: Act
    const action = parseAction(thinkResponse.content);
    const actResult = await executeAction(action, state.sessionId);

    const actStep = await agentReactStepRepository.create({
      taskId: task.id,
      stepIndex: reactSteps.length,
      stepType: 'act',
      content: JSON.stringify(action),
      toolCalls: actResult.toolCalls
    });
    reactSteps.push(actStep);

    // Step 3: Observe
    const observePrompt = `
执行结果：
${JSON.stringify(actResult, null, 2)}

请观察：
1. 执行是否成功？
2. 结果是否符合预期？
3. 是否需要调整策略？

输出格式：
OBSERVATION: [你的观察]
`;

    const observeResponse = await agent.invoke(observePrompt);
    const observeStep = await agentReactStepRepository.create({
      taskId: task.id,
      stepIndex: reactSteps.length,
      stepType: 'observe',
      content: observeResponse.content
    });
    reactSteps.push(observeStep);

    iteration++;
  }

  // 更新任务状态
  await agentTaskRepository.update(task.id, {
    status: taskCompleted ? 'completed' : 'failed',
    completedAt: taskCompleted ? new Date() : null,
    result: {
      reactSteps: reactSteps.map(s => s.id),
      iterations: iteration,
      completed: taskCompleted
    }
  });

  return {
    reactSteps,
    currentTask: await agentTaskRepository.findById(task.id)
  };
}
```

