# 考虑点5：Agent思考范式与LangGraph增强设计

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
- ✅ **LangGraph StateGraph**：三节点DAG（hydrate → route → run_next_task）
- ✅ **检查点保存**：PostgresSaver / MemorySaver
- ✅ **流式事件**：streamMode: ['custom', 'values']
- ✅ **握手转移**：AgentHandoffService 检测 @提及 和 [HANDOFF] 块
- ✅ **决策引擎**：并行决策，优先级排序

**当前缺失：**
- ❌ **ReAct范式**：没有 Think → Act → Observe 循环
- ❌ **Plan-And-Execute**：没有显式的规划阶段
- ❌ **自我修正**：Agent无法评估自己的输出并重试
- ❌ **动态路由**：路由逻辑固定，无法根据任务类型动态调整
- ❌ **并行执行**：任务只能串行执行，无法并行

### 当前图结构

```
START
  ↓
hydrate_session_state
  ↓
route_current_message
  ↓
run_next_task ←──────────────┐
  ↓                          │
  ├── 有更多任务 ─────────────┘
  └── 无更多任务 → END
```

---

## 看业界

### 业界实践案例

#### 1. **LangGraph 官方 ReAct Agent**

```python
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(
    model=llm,
    tools=[search_tool, calculator_tool],
    checkpointer=MemorySaver()
)
```

**图结构：**
```
START → agent → tools → agent → ... → END
```

**特点：**
- 内置工具调用循环
- 自动处理工具结果
- 支持中断和恢复

#### 2. **LangGraph Plan-And-Execute**

```python
from langgraph.graph import StateGraph

# 两阶段图
graph = StateGraph(PlanExecuteState)
graph.add_node("planner", plan_step)
graph.add_node("agent", execute_step)
graph.add_node("replan", replan_step)

graph.add_edge(START, "planner")
graph.add_edge("planner", "agent")
graph.add_conditional_edges(
    "agent",
    should_end,
    {"continue": "replan", "end": END}
)
graph.add_edge("replan", "agent")
```

**特点：**
- 明确的规划和执行分离
- 支持重新规划
- 可追溯的执行步骤

#### 3. **LangGraph Multi-Agent Supervisor**

```python
# Supervisor模式：一个主Agent协调多个子Agent
supervisor_chain = (
    prompt
    | llm.with_structured_output(routeResponse)
)

def supervisor_node(state):
    result = supervisor_chain.invoke(state)
    return {"next": result["next"]}

graph.add_conditional_edges(
    "supervisor",
    lambda x: x["next"],
    {
        "FINISH": END,
        "researcher": "researcher",
        "coder": "coder"
    }
)
```

**特点：**
- 中央协调者模式
- 动态路由到专业Agent
- 支持并行子任务

#### 4. **LangGraph Hierarchical Agent Teams**

```python
# 层级Agent：团队 → 子团队 → 个体Agent
research_graph = create_team_graph(research_agents)
writing_graph = create_team_graph(writing_agents)

super_graph = StateGraph(State)
super_graph.add_node("research_team", research_graph)
super_graph.add_node("writing_team", writing_graph)
```

**特点：**
- 层级化的Agent组织
- 每个团队有独立的图
- 支持复杂的协作模式

#### 5. **LangGraph Human-In-The-Loop**

```python
# 在关键节点暂停，等待人类审批
graph.add_node("human_review", human_review_node)
graph.compile(interrupt_before=["human_review"])

# 恢复执行
graph.invoke(None, config, stream_mode="values")
```

**特点：**
- 支持在任意节点暂停
- 人类可以修改状态后继续
- 适合高风险操作

---

## 思考过程

### 信息启发

LangGraph的核心优势是**状态机 + 检查点**，这使得：
1. 复杂的多步骤流程可以被建模为图
2. 任意节点可以暂停和恢复
3. 状态变更可以被追踪和回溯

### 我们的场景特点

1. **多Agent协作**：需要Supervisor模式协调不同专长的Agent
2. **ReAct循环**：每个Agent需要Think→Act→Observe的内循环
3. **Plan-And-Execute**：需要全局规划和局部执行的外循环
4. **人类参与**：关键决策需要用户确认
5. **并行执行**：独立任务可以并行执行

### 方案抉择

| 范式 | 适用场景 | 优势 | 劣势 |
|------|---------|------|------|
| **ReAct** | 单Agent工具调用 | 简单、灵活 | 无全局规划 |
| **Plan-And-Execute** | 复杂多步骤任务 | 结构清晰 | 规划可能不准确 |
| **Supervisor** | 多Agent协调 | 中央控制 | 单点瓶颈 |
| **Hierarchical** | 大规模团队 | 可扩展 | 复杂度高 |
| **混合** | 我们的场景 | 全面覆盖 | 实现复杂 |

### 最终选择

**三层嵌套图：Supervisor + Plan-And-Execute + ReAct**

```
外层：Supervisor图（协调多Agent）
  ↓
中层：Plan-And-Execute图（任务规划和执行）
  ↓
内层：ReAct图（单步骤执行和工具调用）
```

---

## 给方法

### 方案设计：三层嵌套图架构

#### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│ 外层：Supervisor Graph                                       │
│                                                              │
│  START → analyze_request → route_to_agent                   │
│                                ↓                            │
│              ┌─────────────────┼─────────────────┐          │
│              ↓                 ↓                 ↓          │
│         claude_team       codex_team        gemini_team     │
│              ↓                 ↓                 ↓          │
│              └─────────────────┼─────────────────┘          │
│                                ↓                            │
│                         aggregate_results → END             │
└─────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────┐
│ 中层：Plan-And-Execute Graph（每个Agent团队）                │
│                                                              │
│  START → create_plan → select_task → execute_task           │
│                              ↑              ↓               │
│                              └── replan ←── review_task     │
│                                              ↓              │
│                                    all_done → END           │
└─────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────┐
│ 内层：ReAct Graph（每个任务执行）                            │
│                                                              │
│  START → think → act → observe → evaluate                   │
│              ↑                        ↓                     │
│              └──── needs_retry ───────┘                     │
│                                       ↓                     │
│                              task_done → END                │
└─────────────────────────────────────────────────────────────┘
```

#### 内层：ReAct图实现

```typescript
// src/langgraph/graphs/react.graph.ts

import { StateGraph, END, START } from '@langchain/langgraph';
import { Annotation } from '@langchain/langgraph';

const ReactState = Annotation.Root({
  sessionId: Annotation<string>(),
  agentId: Annotation<string>(),
  taskDescription: Annotation<string>(),
  reactSteps: Annotation<ReactStep[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  currentIteration: Annotation<number>({ default: () => 0 }),
  maxIterations: Annotation<number>({ default: () => 10 }),
  taskCompleted: Annotation<boolean>({ default: () => false }),
  lastObservation: Annotation<string | null>({ default: () => null }),
  workspaceContext: Annotation<string>()
});

export function createReActGraph() {
  const graph = new StateGraph(ReactState);

  graph.addNode('think', thinkNode);
  graph.addNode('act', actNode);
  graph.addNode('observe', observeNode);
  graph.addNode('evaluate', evaluateNode);

  graph.addEdge(START, 'think');
  graph.addEdge('think', 'act');
  graph.addEdge('act', 'observe');
  graph.addEdge('observe', 'evaluate');

  graph.addConditionalEdges('evaluate', (state) => {
    if (state.taskCompleted) return END;
    if (state.currentIteration >= state.maxIterations) return END;
    return 'think'; // 继续循环
  });

  return graph.compile();
}

// 节点实现
async function thinkNode(state: typeof ReactState.State) {
  const agent = await agentRegistry.getAgent(state.agentId);

  const prompt = `
任务：${state.taskDescription}

当前工作区状态：
${state.workspaceContext}

${state.lastObservation ? `上次观察结果：\n${state.lastObservation}` : ''}

已完成的步骤（${state.currentIteration}/${state.maxIterations}）：
${state.reactSteps.map((s, i) => `${i + 1}. [${s.type}] ${s.summary}`).join('\n')}

请思考下一步应该做什么。

<thinking>
[详细分析当前状态和下一步计划]
</thinking>

THOUGHT: [简洁的思考总结]
ACTION: [要执行的动作] 或 FINISH: [完成说明]
`;

  const response = await agent.invoke(prompt);

  const step: ReactStep = {
    type: 'think',
    content: response.content,
    summary: extractThought(response.content),
    timestamp: new Date()
  };

  return {
    reactSteps: [step],
    taskCompleted: response.content.includes('FINISH:')
  };
}

async function actNode(state: typeof ReactState.State) {
  if (state.taskCompleted) return {};

  const lastThink = state.reactSteps.findLast(s => s.type === 'think');
  if (!lastThink) return {};

  const action = parseAction(lastThink.content);
  const result = await executeAction(action, state.sessionId);

  const step: ReactStep = {
    type: 'act',
    content: JSON.stringify({ action, result }),
    summary: `执行: ${action.name}`,
    timestamp: new Date()
  };

  return { reactSteps: [step] };
}

async function observeNode(state: typeof ReactState.State) {
  if (state.taskCompleted) return {};

  const lastAct = state.reactSteps.findLast(s => s.type === 'act');
  if (!lastAct) return {};

  const actData = JSON.parse(lastAct.content);
  const observation = formatObservation(actData.result);

  const step: ReactStep = {
    type: 'observe',
    content: observation,
    summary: `观察: ${observation.slice(0, 50)}...`,
    timestamp: new Date()
  };

  return {
    reactSteps: [step],
    lastObservation: observation
  };
}

async function evaluateNode(state: typeof ReactState.State) {
  return {
    currentIteration: state.currentIteration + 1
  };
}
```

#### 中层：Plan-And-Execute图实现

```typescript
// src/langgraph/graphs/plan-execute.graph.ts

const PlanExecuteState = Annotation.Root({
  sessionId: Annotation<string>(),
  agentId: Annotation<string>(),
  userRequest: Annotation<string>(),
  plan: Annotation<ExecutionPlan | null>({ default: () => null }),
  taskQueue: Annotation<AgentTask[]>({ default: () => [] }),
  completedTasks: Annotation<AgentTask[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  currentTask: Annotation<AgentTask | null>({ default: () => null }),
  replanCount: Annotation<number>({ default: () => 0 }),
  maxReplans: Annotation<number>({ default: () => 3 })
});

export function createPlanExecuteGraph(reactGraph: CompiledGraph) {
  const graph = new StateGraph(PlanExecuteState);

  graph.addNode('create_plan', createPlanNode);
  graph.addNode('select_task', selectTaskNode);
  graph.addNode('execute_task', async (state) => {
    // 调用内层ReAct图
    const result = await reactGraph.invoke({
      sessionId: state.sessionId,
      agentId: state.agentId,
      taskDescription: state.currentTask!.description,
      workspaceContext: await getWorkspaceContext(state.sessionId)
    });

    return {
      completedTasks: [{
        ...state.currentTask!,
        status: result.taskCompleted ? 'completed' : 'failed',
        reactSteps: result.reactSteps
      }]
    };
  });
  graph.addNode('review_task', reviewTaskNode);
  graph.addNode('replan', replanNode);

  graph.addEdge(START, 'create_plan');
  graph.addEdge('create_plan', 'select_task');

  graph.addConditionalEdges('select_task', (state) => {
    if (!state.currentTask) return END; // 所有任务完成
    return 'execute_task';
  });

  graph.addEdge('execute_task', 'review_task');

  graph.addConditionalEdges('review_task', (state) => {
    const lastCompleted = state.completedTasks.slice(-1)[0];

    if (lastCompleted?.status === 'completed') {
      return 'select_task'; // 继续下一个任务
    }

    if (state.replanCount < state.maxReplans) {
      return 'replan'; // 重新规划
    }

    return 'select_task'; // 放弃，继续下一个任务
  });

  graph.addEdge('replan', 'select_task');

  return graph.compile({
    checkpointer: new PostgresSaver(pool)
  });
}

async function createPlanNode(state: typeof PlanExecuteState.State) {
  const agent = await agentRegistry.getAgent(state.agentId);

  const prompt = `
你是一个任务规划专家。请将以下需求分解为可执行的子任务：

需求：${state.userRequest}

要求：
1. 每个任务应该是独立可执行的
2. 标注任务之间的依赖关系
3. 估计每个任务的复杂度（简单/中等/复杂）

输出JSON格式：
{
  "goal": "总体目标",
  "tasks": [
    {
      "id": "task-1",
      "description": "任务描述",
      "complexity": "simple|medium|complex",
      "dependencies": []
    }
  ]
}
`;

  const response = await agent.invoke(prompt);
  const planData = JSON.parse(extractJSON(response.content));

  const tasks: AgentTask[] = planData.tasks.map((t: any) => ({
    id: t.id,
    description: t.description,
    complexity: t.complexity,
    dependencies: t.dependencies,
    status: 'pending'
  }));

  return {
    plan: { goal: planData.goal, tasks },
    taskQueue: tasks.filter(t => t.dependencies.length === 0)
  };
}

async function selectTaskNode(state: typeof PlanExecuteState.State) {
  const completedIds = new Set(
    state.completedTasks
      .filter(t => t.status === 'completed')
      .map(t => t.id)
  );

  // 找到依赖已满足的下一个任务
  const nextTask = state.plan?.tasks.find(task => {
    if (completedIds.has(task.id)) return false;
    if (task.status === 'failed') return false;
    return task.dependencies.every(dep => completedIds.has(dep));
  });

  return { currentTask: nextTask || null };
}

async function reviewTaskNode(state: typeof PlanExecuteState.State) {
  const lastTask = state.completedTasks.slice(-1)[0];
  if (!lastTask) return {};

  // 简单的质量检查
  const passed = lastTask.status === 'completed' &&
    lastTask.reactSteps?.some(s => s.type === 'act');

  if (!passed) {
    return {
      completedTasks: [{
        ...lastTask,
        status: 'failed'
      }]
    };
  }

  return {};
}

async function replanNode(state: typeof PlanExecuteState.State) {
  const failedTask = state.completedTasks.findLast(t => t.status === 'failed');
  if (!failedTask) return {};

  // 将失败的任务重置为pending
  const updatedTasks = state.plan!.tasks.map(t =>
    t.id === failedTask.id ? { ...t, status: 'pending' } : t
  );

  return {
    plan: { ...state.plan!, tasks: updatedTasks },
    replanCount: state.replanCount + 1
  };
}
```

#### 外层：Supervisor图实现

```typescript
// src/langgraph/graphs/supervisor.graph.ts

const SupervisorState = Annotation.Root({
  sessionId: Annotation<string>(),
  userMessage: Annotation<string>(),
  agentResults: Annotation<AgentResult[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  nextAgent: Annotation<string | null>({ default: () => null }),
  finalResponse: Annotation<string | null>({ default: () => null })
});

export function createSupervisorGraph(
  planExecuteGraph: CompiledGraph,
  agents: AgentConfig[]
) {
  const graph = new StateGraph(SupervisorState);

  // 添加Supervisor节点
  graph.addNode('supervisor', supervisorNode);

  // 为每个Agent添加节点
  for (const agent of agents) {
    graph.addNode(agent.id, async (state) => {
      const result = await planExecuteGraph.invoke({
        sessionId: state.sessionId,
        agentId: agent.id,
        userRequest: state.userMessage
      });

      return {
        agentResults: [{
          agentId: agent.id,
          agentName: agent.name,
          completedTasks: result.completedTasks,
          summary: await generateSummary(result)
        }]
      };
    });
  }

  // 添加聚合节点
  graph.addNode('aggregate', aggregateNode);

  // 边定义
  graph.addEdge(START, 'supervisor');

  graph.addConditionalEdges(
    'supervisor',
    (state) => state.nextAgent || 'aggregate',
    {
      ...Object.fromEntries(agents.map(a => [a.id, a.id])),
      aggregate: 'aggregate',
      FINISH: END
    }
  );

  // 每个Agent完成后回到Supervisor
  for (const agent of agents) {
    graph.addEdge(agent.id, 'supervisor');
  }

  graph.addEdge('aggregate', END);

  return graph.compile({
    checkpointer: new PostgresSaver(pool)
  });
}

async function supervisorNode(state: typeof SupervisorState.State) {
  const supervisorAgent = await agentRegistry.getAgent('supervisor');

  const agentList = agents.map(a => `- ${a.id}: ${a.description}`).join('\n');
  const completedAgents = state.agentResults.map(r => r.agentId);

  const prompt = `
你是一个多Agent协作系统的协调者。

用户请求：${state.userMessage}

可用的Agent：
${agentList}

已完成的Agent：${completedAgents.join(', ') || '无'}

已有的结果：
${state.agentResults.map(r => `${r.agentName}: ${r.summary}`).join('\n') || '无'}

请决定：
1. 下一步应该调用哪个Agent？
2. 或者是否已经可以生成最终响应？

输出JSON：
{
  "next": "agent_id 或 FINISH",
  "reason": "选择原因"
}
`;

  const response = await supervisorAgent.invoke(prompt);
  const decision = JSON.parse(extractJSON(response.content));

  return { nextAgent: decision.next };
}

async function aggregateNode(state: typeof SupervisorState.State) {
  const summaryAgent = await agentRegistry.getAgent('summary');

  const prompt = `
请综合以下Agent的工作结果，生成最终响应：

${state.agentResults.map(r => `
## ${r.agentName} 的工作
${r.summary}
`).join('\n')}

请生成一个清晰、完整的最终响应。
`;

  const response = await summaryAgent.invoke(prompt);

  return { finalResponse: response.content };
}
```

#### 集成到现有系统

**替换现有的FreeChatGraphService**

```typescript
// src/langgraph/services/langgraph-orchestrator.service.ts (增强)

@Injectable()
export class LangGraphOrchestratorService {
  private supervisorGraph: CompiledGraph;

  constructor(
    private readonly agentRegistry: AgentRegistryService,
    private readonly workspaceSync: WorkspaceSyncService
  ) {
    // 构建三层嵌套图
    const reactGraph = createReActGraph();
    const planExecuteGraph = createPlanExecuteGraph(reactGraph);
    this.supervisorGraph = createSupervisorGraph(
      planExecuteGraph,
      agentRegistry.getAllAgents()
    );
  }

  async runTurn(sessionId: string, message: Message): Promise<void> {
    const config = {
      configurable: { thread_id: sessionId },
      streamMode: ['custom', 'values'] as const
    };

    const stream = await this.supervisorGraph.stream(
      {
        sessionId,
        userMessage: message.content
      },
      config
    );

    for await (const event of stream) {
      await this.eventBridge.handleEvent(sessionId, event);
    }
  }
}
```

#### Human-In-The-Loop 集成

```typescript
// 在关键节点添加人类审批
const graphWithHITL = graph.compile({
  checkpointer: new PostgresSaver(pool),
  interruptBefore: ['execute_task'] // 执行前暂停
});

// 前端触发恢复
async function approveAndResume(sessionId: string, approved: boolean) {
  const config = { configurable: { thread_id: sessionId } };

  if (approved) {
    // 恢复执行
    await graphWithHITL.invoke(null, config);
  } else {
    // 修改状态后恢复
    await graphWithHITL.updateState(config, {
      currentTask: null // 跳过当前任务
    });
    await graphWithHITL.invoke(null, config);
  }
}
```

#### 并行任务执行

```typescript
// 使用LangGraph的Send API实现并行执行
import { Send } from '@langchain/langgraph';

async function selectParallelTasksNode(state: typeof PlanExecuteState.State) {
  const completedIds = new Set(
    state.completedTasks
      .filter(t => t.status === 'completed')
      .map(t => t.id)
  );

  // 找到所有可以并行执行的任务
  const readyTasks = state.plan?.tasks.filter(task => {
    if (completedIds.has(task.id)) return false;
    return task.dependencies.every(dep => completedIds.has(dep));
  }) || [];

  if (readyTasks.length === 0) return END;

  // 并行发送到execute_task节点
  return readyTasks.map(task =>
    new Send('execute_task', {
      ...state,
      currentTask: task
    })
  );
}
```

#### 配置文件

```json
// config/langgraph.config.json
{
  "graphs": {
    "react": {
      "maxIterations": 10,
      "timeout": 300000
    },
    "planExecute": {
      "maxReplans": 3,
      "parallelTasks": true,
      "maxParallelTasks": 3
    },
    "supervisor": {
      "maxAgentCalls": 10,
      "enableHITL": false,
      "hitlNodes": ["execute_task"]
    }
  },
  "checkpointer": {
    "type": "postgres",
    "ttl": 86400
  }
}
```
