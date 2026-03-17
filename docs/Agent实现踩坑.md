# Q: 如何避免一次回答陷入无限循环

# A: 避免 Agent 无限循环的策略

这是构建 Agent 系统时一个非常关键的工程问题。以下从多个层面给出解决方案：

---

## 1. 硬性限制（最基础的防线）

```python
class AgentLoop:
    def __init__(self, max_iterations=10, max_time_seconds=120):
        self.max_iterations = max_iterations
        self.max_time_seconds = max_time_seconds

    def run(self, task: str):
        start_time = time.time()
        iteration = 0

        while True:
            iteration += 1

            # 🔒 迭代次数上限
            if iteration > self.max_iterations:
                return self._graceful_exit("达到最大迭代次数限制")

            # 🔒 超时保护
            if time.time() - start_time > self.max_time_seconds:
                return self._graceful_exit("执行超时")

            result = self._step(task)

            if result.is_final:
                return result

    def _graceful_exit(self, reason: str):
        """优雅退出：汇总已有结果而非直接崩溃"""
        return self.llm.summarize(
            f"由于{reason}，请基于已收集的信息给出当前最佳答案",
            context=self.collected_results
        )
```

## 2. 循环检测（检测重复行为）

```python
class LoopDetector:
    def __init__(self, window_size=3):
        self.action_history: list[str] = []
        self.window_size = window_size

    def is_looping(self, current_action: str) -> bool:
        self.action_history.append(current_action)

        if len(self.action_history) < self.window_size * 2:
            return False

        # 检测：最近 N 步是否与之前 N 步完全相同
        recent = self.action_history[-self.window_size:]
        previous = self.action_history[-self.window_size*2:-self.window_size]

        if recent == previous:
            return True

        # 检测：同一动作连续重复
        if len(set(self.action_history[-self.window_size:])) == 1:
            return True

        return False

    def get_repeated_pattern(self) -> str:
        """返回重复模式的描述，用于提示 LLM 改变策略"""
        return f"检测到重复动作模式: {self.action_history[-self.window_size:]}"
```

## 3. 进度跟踪（检测是否"原地踏步"）

```python
class ProgressTracker:
    """核心思想：如果多步之后状态没有实质变化，就是在循环"""

    def __init__(self, stall_threshold=3):
        self.state_hashes: list[str] = []
        self.stall_threshold = stall_threshold

    def update(self, state: dict) -> bool:
        """返回 True 表示有进展，False 表示停滞"""
        current_hash = self._hash_state(state)
        self.state_hashes.append(current_hash)

        if len(self.state_hashes) < self.stall_threshold:
            return True

        # 最近 N 步的状态是否全部相同
        recent = self.state_hashes[-self.stall_threshold:]
        if len(set(recent)) == 1:
            return False  # 停滞了

        return True

    def _hash_state(self, state: dict) -> str:
        """对关键状态信息做哈希"""
        import hashlib
        key_info = str(sorted(state.items()))
        return hashlib.md5(key_info.encode()).hexdigest()
```

## 4. 提示工程层面的防御

```python
SYSTEM_PROMPT = """
你是一个任务执行 Agent。请严格遵守以下规则：

## 反循环规则
1. 每一步必须产生【新信息】或【新进展】，禁止重复已完成的操作
2. 如果一个工具调用失败，最多重试 2 次，然后必须换策略
3. 如果你发现自己在重复相同的动作，立即停下来，输出当前最佳答案
4. 在每一步开始前，先回顾已完成的步骤，确认下一步是不同的

## 终止条件
- 任务已完成 → 输出最终答案
- 信息不足但已穷尽可用工具 → 说明局限并给出部分答案
- 任务无法完成 → 明确说明原因
"""

# 在每一步注入"反思"提示
def build_step_prompt(history: list, current_step: int, max_steps: int):
    return f"""
当前进度: 第 {current_step}/{max_steps} 步
已执行动作: {[h['action'] for h in history]}

⚠️ 请确保下一步操作与以上不重复。
如果任务已有足够信息可以回答，请直接给出最终答案。
"""
```

## 5. 完整的 Agent 循环架构

```python
class RobustAgent:
    def __init__(self, llm, tools, config=None):
        self.llm = llm
        self.tools = tools
        self.config = config or {
            "max_iterations": 10,
            "max_time_seconds": 120,
            "max_retries_per_tool": 2,
        }
        self.loop_detector = LoopDetector(window_size=3)
        self.progress_tracker = ProgressTracker(stall_threshold=3)

    def run(self, task: str) -> str:
        history = []
        tool_retry_counts = defaultdict(int)
        start_time = time.time()

        for step in range(1, self.config["max_iterations"] + 1):
            # ====== 安全检查 ======
            # 超时检查
            if time.time() - start_time > self.config["max_time_seconds"]:
                return self._force_conclude(history, "超时")

            # 构建 prompt（注入历史 + 反循环提示）
            prompt = self._build_prompt(task, history, step)
            response = self.llm.call(prompt)

            # ====== 判断是否结束 ======
            if response.type == "final_answer":
                return response.content

            # ====== 循环检测 ======
            action_sig = f"{response.tool_name}({response.tool_args})"

            if self.loop_detector.is_looping(action_sig):
                # 策略1: 提示 LLM 换思路
                history.append({
                    "role": "system",
                    "content": f"⚠️ {self.loop_detector.get_repeated_pattern()}，请换一种方法。"
                })
                continue  # 给一次机会换策略

            # ====== 工具重试限制 ======
            if tool_retry_counts[action_sig] >= self.config["max_retries_per_tool"]:
                history.append({
                    "role": "system",
                    "content": f"工具 {response.tool_name} 已重试多次，请使用其他方法。"
                })
                continue

            # ====== 执行工具 ======
            try:
                result = self._execute_tool(response.tool_name, response.tool_args)
            except Exception as e:
                tool_retry_counts[action_sig] += 1
                result = f"执行失败: {e}"

            # ====== 进度检测 ======
            state = {"history_len": len(history), "result": str(result)[:200]}
            if not self.progress_tracker.update(state):
                return self._force_conclude(history, "未检测到进展")

            history.append({
                "action": action_sig,
                "result": result
            })

        # 达到最大步数
        return self._force_conclude(history, "达到最大步数")

    def _force_conclude(self, history, reason):
        """强制让 LLM 基于已有信息给出答案"""
        return self.llm.call(
            f"由于【{reason}】，你必须立即基于以下已有信息给出最终答案:\n"
            f"{json.dumps(history, ensure_ascii=False)}"
        )
```

## 6. 策略总结

```
┌─────────────────────────────────────────────────────────┐
│                    防无限循环多层防御                       │
├─────────────┬───────────────────────────────────────────┤
│  第1层       │ 硬性上限: max_iterations + timeout        │
│  (必须有)    │ → 最后一道防线，保证一定会停               │
├─────────────┼───────────────────────────────────────────┤
│  第2层       │ 循环检测: 识别重复 action 模式             │
│  (强烈建议)  │ → 检测到后注入提示，要求换策略             │
├─────────────┼───────────────────────────────────────────┤
│  第3层       │ 进度追踪: 状态是否有实质变化               │
│  (推荐)      │ → 原地踏步时强制总结退出                   │
├─────────────┼───────────────────────────────────────────┤
│  第4层       │ Prompt 工程: 在提示中明确反循环规则         │
│  (推荐)      │ → 从源头减少 LLM 产生循环行为的倾向        │
├─────────────┼───────────────────────────────────────────┤
│  第5层       │ 工具级重试限制: 同一调用最多重试 N 次       │
│  (推荐)      │ → 防止 "失败→重试→失败" 的死循环          │
├─────────────┼───────────────────────────────────────────┤
│  第6层       │ 优雅退出: 强制结束时汇总已有信息给答案      │
│  (重要)      │ → 确保用户总能得到有意义的输出              │
└─────────────┴───────────────────────────────────────────┘
```

> **核心原则**：第1层是**必须**的底线保障，其他层是逐步优化。在实际生产系统中，建议至少实现 **第1层 + 第2层 + 第6层**，即：硬限制 + 循环检测 + 优雅退出。

# Q: 那如果我的系统使用Claude code/codex/gemini cli这样的cli工具作为agent，它们本身就是成熟的agent工具，我关注MultiAgent的编排协作。我还需要在业务层关注无限循环的问题吗？也许cli已经做好了约束？

# A: Multi-Agent 编排层的循环问题

## 简短回答

**单个 Agent 的内部循环你不用担心，但编排层的循环是全新的问题，CLI 工具管不到。**

---

## 区分两个层次的循环

```
┌─────────────────────────────────────────────────┐
│           你的编排层 (Orchestrator)               │
│                                                  │
│  ┌──────────┐     ┌──────────┐    ┌──────────┐  │
│  │ Claude   │ ──► │ Codex    │ ──►│ Gemini   │  │
│  │ Code     │ ◄── │ CLI      │ ◄──│ CLI      │  │
│  └──────────┘     └──────────┘    └──────────┘  │
│  各自内部有        各自内部有       各自内部有      │
│  循环保护 ✅       循环保护 ✅      循环保护 ✅     │
│                                                  │
│  但是 Agent 之间的交互循环 ❌ 没人管               │
└─────────────────────────────────────────────────┘
```

## CLI 工具已经帮你解决的 ✅

```python
# 你调用 Claude Code 执行一个任务
result = subprocess.run(
    ["claude", "-p", "重构这个函数"],
    capture_output=True, timeout=300
)
# ✅ Claude Code 内部不会无限循环
# ✅ 它有自己的 token 限制、迭代限制
# ✅ 单次调用一定会返回结果
```

**这些你不用操心：**
- 单个 Agent 内部的工具调用循环
- 单个 Agent 的 token 消耗失控
- 单个 Agent 永远不返回

## 你仍然需要关注的 ❌

### 1. 乒乓循环（Agent 间互相推诿）

```
最常见也最危险的模式：

Orchestrator: "代码有 bug，交给 Coder 修"
    → Claude Code: "修好了"（实际引入新 bug）
Orchestrator: "测试没过，交给 Coder 修" 
    → Claude Code: "修好了"（改回去了）
Orchestrator: "测试没过，交给 Coder 修"
    → Claude Code: "修好了"（又引入同样的 bug）
    ... 无限循环 ...

每一次 CLI 调用都正常返回了！
但编排层在不停地重复调用。
```

### 2. 发散循环（任务越拆越多）

```
Orchestrator: "构建一个 web 应用"
    → Planner: "需要 5 个子任务"
    → 执行子任务 1 → "发现还需要 3 个前置任务"
    → 执行前置任务 → "发现还需要依赖..."
    → 任务数量爆炸，永远做不完
```

### 3. 质量不收敛（反复 review 永不满意）

```
Orchestrator:
    → Coder: 写代码
    → Reviewer: "有 3 个问题"
    → Coder: 修复（但 Reviewer 又发现新问题）
    → Reviewer: "有 2 个新问题"
    → Coder: 修复（又产生新问题）
    ... 永远达不到 Reviewer 的标准 ...
```

---

## 编排层应该加的防护

### 实用方案：轻量但有效

```python
class MultiAgentOrchestrator:
    def __init__(self):
        self.config = {
            "max_agent_calls": 15,        # 总调用次数上限
            "max_rounds_per_phase": 3,     # 每个阶段最大轮次 (如 code→review)
            "max_total_cost_usd": 5.0,     # 💰 成本上限（非常实用）
            "timeout_minutes": 30,         # 整体超时
        }

    def run(self, task: str):
        total_calls = 0
        start_time = time.time()
        total_cost = 0.0

        plan = self.plan(task)

        for phase in plan.phases:
            round_count = 0

            while not phase.is_complete():
                # === 防护检查 ===
                total_calls += 1
                round_count += 1

                if total_calls > self.config["max_agent_calls"]:
                    return self.force_wrap_up("总调用次数超限")

                if round_count > self.config["max_rounds_per_phase"]:
                    phase.accept_current_result()  # 接受当前结果，继续下一阶段
                    break

                elapsed = (time.time() - start_time) / 60
                if elapsed > self.config["timeout_minutes"]:
                    return self.force_wrap_up("超时")

                if total_cost > self.config["max_total_cost_usd"]:
                    return self.force_wrap_up("成本超限")

                # === 执行 ===
                result = self.call_agent(phase.current_agent, phase.current_task)
                total_cost += result.estimated_cost
                phase.update(result)
```

### 针对"Coder↔Reviewer"循环的实战模式

```python
def code_review_loop(self, task: str, max_rounds: int = 3):
    """这是最常见的多 Agent 协作模式"""

    code = self.call_agent("claude-code", f"实现: {task}")

    for round_num in range(max_rounds):
        review = self.call_agent("gemini", f"Review 这段代码:\n{code}")

        if review.approved or round_num == max_rounds - 1:
            if round_num == max_rounds - 1 and not review.approved:
                log.warning(f"Review 未通过但已达最大轮次，接受当前结果")
            return code

        # 关键：把轮次信息传给 Coder，制造收敛压力
        code = self.call_agent("claude-code",
            f"修复以下问题（第{round_num+2}/{max_rounds}轮，请一次性解决所有问题）:\n"
            f"{review.issues}\n\n当前代码:\n{code}"
        )

    return code
```

### 防发散：任务数量限制

```python
def execute_plan(self, plan: Plan):
    MAX_TOTAL_SUBTASKS = 20
    spawned_tasks = 0

    queue = deque(plan.initial_tasks)

    while queue:
        task = queue.popleft()
        result = self.call_agent(task.agent, task.description)

        # 如果 Agent 产出了新的子任务
        if result.new_subtasks:
            spawned_tasks += len(result.new_subtasks)

            if spawned_tasks > MAX_TOTAL_SUBTASKS:
                log.warning("子任务数量爆炸，停止拆分")
                # 不再拆分，直接把剩余工作打包给一个 Agent
                self.call_agent("claude-code",
                    f"请直接完成以下所有剩余工作:\n{result.new_subtasks}")
                break

            queue.extend(result.new_subtasks)
```

---

## 实际建议总结

```
你需要的防护          │ 复杂度  │ 优先级
─────────────────────┼────────┼───────
总调用次数上限         │  低    │ 🔴 必须
总超时时间            │  低    │ 🔴 必须
成本上限 ($)          │  低    │ 🔴 必须（真金白银）
每阶段最大轮次         │  低    │ 🟡 强烈建议
降级策略(达到限制时)    │  中    │ 🟡 强烈建议
相同输入检测           │  中    │ 🟢 有则更好

你不需要操心的
─────────────────────
单个 CLI 的内部循环     → CLI 自己管
单次调用的 token 限制   → CLI 自己管
单个 Agent 的工具重试   → CLI 自己管
```

> **一句话总结**：CLI 工具保证每次调用都会返回，但**你的 `while/for` 循环**才是无限循环的来源。加一个调用计数器 + 成本上限 + 阶段轮次限制，就能覆盖绝大多数场景。不需要复杂的循环检测算法——在编排层，简单的计数器比花哨的检测更可靠。

# Q: 现在遇到另一个问题，如果我有一个超大任务，导致一次回答超过模型/cli的max token限制，无法一次性完成任务，在业务层怎么解决？

# A: 超大任务突破 Token 限制的策略

## 先理解问题的本质

```
超大任务失败的两种情况：

1. 输出截断：Agent 在生成过程中 token 耗尽，输出不完整
2. 上下文溢出：任务描述 + 历史上下文本身就超出输入限制

               输入上下文窗口                    输出限制
    ┌──────────────────────────────┐    ┌──────────────────┐
    │ system prompt                │    │                  │
    │ 任务描述                     │    │  生成的内容       │
    │ 已有代码/文档(可能巨大)       │    │  可能写到一半     │
    │ 历史对话                     │    │  就被截断了...    │
    │ ...放不下了                  │    │                  │
    └──────────────────────────────┘    └──────────────────┘
```

---

## 策略一：任务分解（最核心的方法）

### 先规划，再分片执行

```python
class TaskDecomposer:
    """核心思想：永远不要让单次调用承担超大产出"""

    def execute_large_task(self, task: str):
        # 第一步：让 Agent 只做规划，不做执行
        plan = self.call_agent("claude", 
            f"""分析以下任务，将其拆解为可独立执行的子任务。
每个子任务的产出应控制在单个文件或单个函数级别。
只输出计划，不要执行。

任务: {task}

输出格式:
- subtask_id: 描述
- 依赖: [依赖的subtask_id]
- 预期产出: 文件名或描述
""")

        subtasks = self.parse_plan(plan)

        # 第二步：逐个执行子任务
        results = {}
        for subtask in topological_sort(subtasks):
            # 只传入该子任务需要的上下文，而非全部历史
            context = self.gather_context(subtask, results)

            result = self.call_agent("claude-code",
                f"""执行以下子任务:
{subtask.description}

已完成的相关工作:
{context}
""")
            results[subtask.id] = result

        return results
```

### 实际例子：大型代码生成

```python
# ❌ 错误做法：一次性让 Agent 生成整个项目
result = call_agent("帮我生成一个完整的电商系统，包含用户、商品、订单、支付模块")
# → 大概率输出截断，后面几个模块残缺

# ✅ 正确做法：分层执行
def build_large_project(spec: str):

    # 阶段1: 生成架构设计（产出小，不会截断）
    architecture = call_agent("claude",
        f"为以下项目设计架构，输出目录结构和模块接口定义:\n{spec}")

    # 阶段2: 生成每个模块的接口/类型（产出小）
    interfaces = call_agent("claude-code",
        f"根据以下架构，生成所有接口定义和类型文件:\n{architecture}")

    # 阶段3: 逐模块实现（每次调用产出可控）
    modules = parse_modules(architecture)
    for module in modules:
        call_agent("claude-code",
            f"""实现 {module.name} 模块。
接口定义: {interfaces[module.name]}
依赖模块的接口: {[interfaces[dep] for dep in module.deps]}
只实现这一个模块。""")

    # 阶段4: 集成测试
    call_agent("claude-code", "运行所有测试，修复集成问题")
```

---

## 策略二：截断检测 + 断点续传

```python
class ContinuationHandler:
    """当输出被截断时，检测并继续"""

    def call_with_continuation(self, agent: str, prompt: str,
                                max_continuations: int = 5) -> str:
        full_output = ""

        for i in range(max_continuations):
            if i == 0:
                result = self.call_agent(agent, prompt)
            else:
                result = self.call_agent(agent,
                    f"""你之前的输出被截断了。以下是你已经生成的内容的最后部分:

...{full_output[-2000:]}

请从截断处继续，不要重复已有内容。""")

            full_output += result.content

            # 检测是否完整结束
            if self.looks_complete(result):
                break

        return full_output

    def looks_complete(self, result) -> bool:
        """判断输出是否自然结束（而非被截断）"""
        content = result.content.rstrip()

        # 检查 CLI 工具的截断信号
        if result.finish_reason == "length":  # API 层面的信号
            return False

        # 启发式检查：代码是否括号匹配
        if content.count('{') != content.count('}'):
            return False
        if content.count('```') % 2 != 0:
            return False

        # 看最后是否有自然结束的迹象
        natural_endings = ['done', '完成', 'completed', '```\n']
        if any(content.lower().endswith(e) for e in natural_endings):
            return True

        return True  # 默认认为完整
```

---

## 策略三：文件粒度的分治

```python
class FileByFileExecutor:
    """最实用的模式：让每次调用只处理一个文件"""

    def refactor_large_codebase(self, repo_path: str, instruction: str):
        # 1. 先分析需要修改哪些文件（产出小）
        analysis = self.call_agent("claude",
            f"""分析以下代码仓库，列出需要修改的文件及修改要点:
指令: {instruction}
文件列表: {self.list_files(repo_path)}

对每个需要修改的文件，输出:
- 文件路径
- 修改内容摘要（一句话）
- 优先级和依赖顺序
""")

        files_to_modify = self.parse_file_list(analysis)

        # 2. 逐文件修改（每次调用的输入输出都可控）
        for file_info in files_to_modify:
            file_content = read_file(file_info.path)

            self.call_agent("claude-code",
                f"""修改文件 {file_info.path}:
修改要求: {file_info.summary}
全局指令: {instruction}

当前文件内容:
{file_content}

只修改这一个文件。""")

    def process_large_document(self, doc_path: str, instruction: str):
        """处理超大文档：分块处理 + 汇总"""

        chunks = self.split_document(doc_path, chunk_size=3000)  # tokens
        chunk_results = []

        for i, chunk in enumerate(chunks):
            result = self.call_agent("claude",
                f"""处理以下文档片段 ({i+1}/{len(chunks)}):
全局任务: {instruction}

文档片段:
{chunk}

之前片段的处理摘要:
{self.summarize_results(chunk_results[-3:])}  # 只保留最近3个
""")
            chunk_results.append(result)

        # 最终汇总
        return self.call_agent("claude",
            f"将以下分段处理结果汇总为最终输出:\n{chunk_results}")
```

---

## 策略四：上下文压缩（解决输入溢出）

```python
class ContextManager:
    """当历史信息太多，输入窗口放不下时"""

    def __init__(self, max_context_tokens=50000):
        self.max_context_tokens = max_context_tokens
        self.full_history = []         # 完整历史（存本地）
        self.compressed_history = ""   # 压缩后的历史（传给Agent）

    def add_result(self, step_name: str, result: str):
        self.full_history.append({"step": step_name, "result": result})

        # 当历史太长时，压缩旧的部分
        if self.estimate_tokens(self.full_history) > self.max_context_tokens:
            self._compress()

    def _compress(self):
        """保留最近 N 条完整记录，旧的压缩为摘要"""
        recent = self.full_history[-3:]  # 最近3条保留原文
        older = self.full_history[:-3]   # 更早的压缩

        if older:
            summary = self.call_agent("claude",
                f"""将以下工作历史压缩为简洁摘要，保留关键决策和产出:
{json.dumps(older, ensure_ascii=False)}
只保留: 做了什么、关键结论、产出了哪些文件""")

            self.compressed_history = summary

        self.full_history = recent

    def get_context(self) -> str:
        """构建传给 Agent 的上下文"""
        parts = []
        if self.compressed_history:
            parts.append(f"## 早期工作摘要\n{self.compressed_history}")
        parts.append(f"## 最近步骤\n{json.dumps(self.full_history, ensure_ascii=False)}")
        return "\n\n".join(parts)
```

---

## 策略五：产出物存文件系统而非上下文

```python
# 这是最关键的思维转变 ⭐

# ❌ 所有中间结果都放在对话/内存中传递
result1 = agent("生成模块A的代码")  # 2000 行代码在内存中
result2 = agent(f"基于模块A生成模块B: {result1}")  # 上下文爆炸

# ✅ 让 Agent 写文件，后续 Agent 读文件
agent("claude-code", "生成模块A，写入 src/module_a.py")
agent("claude-code", "阅读 src/module_a.py 的接口，生成模块B，写入 src/module_b.py")
# Agent 自己决定读文件的哪些部分，天然控制了上下文大小

class FileSystemAsMemory:
    """用文件系统作为 Agent 间的共享内存"""

    def __init__(self, workspace: str):
        self.workspace = workspace
        # 维护一个轻量的索引文件
        self.manifest_path = f"{workspace}/MANIFEST.md"

    def execute_subtask(self, subtask, agent="claude-code"):
        # 每次调用只传: 任务描述 + 文件索引（很小）
        # Agent 自己按需读取文件内容
        manifest = read_file(self.manifest_path)

        result = self.call_cli(agent,
            f"""工作目录: {self.workspace}
已有文件索引:
{manifest}

任务: {subtask.description}

完成后更新 MANIFEST.md。""")

        return result
```

---

## 完整的方案组合

```python
class LargeTaskExecutor:

    def execute(self, task: str):
        workspace = create_temp_workspace()

        # 1️⃣ 规划（产出小，不会截断）
        plan = self.call_agent("claude",
            f"将以下任务拆解为子任务，每个子任务产出不超过一个文件:\n{task}")

        subtasks = parse_plan(plan)
        context_mgr = ContextManager()

        # 2️⃣ 逐任务执行
        for subtask in subtasks:
            # 上下文 = 压缩的历史 + 文件索引（不是完整文件内容）
            ctx = context_mgr.get_context()
            manifest = read_file(f"{workspace}/MANIFEST.md")

            result = self.call_with_continuation(  # 截断续传
                "claude-code",
                f"""工作目录: {workspace}
项目文件: {manifest}
之前的工作: {ctx}

当前任务: {subtask}""",
                max_continuations=3
            )

            context_mgr.add_result(subtask, summarize(result))

        # 3️⃣ 最终验证
        self.call_agent("claude-code",
            f"在 {workspace} 中运行所有测试，修复问题")
```

---

## 决策指南

```
你的场景是什么？
│
├── 生成大量代码（多文件项目）
│   └── ✅ 文件粒度分治 + 文件系统作为共享内存
│
├── 处理/分析超大文档
│   └── ✅ 分块处理 + 滚动摘要
│
├── 复杂重构（大量文件需要协调修改）
│   └── ✅ 先分析影响范围 → 逐文件修改 → 集成验证
│
├── 单个文件就巨大（如5000行代码文件）
│   └── ✅ 截断续传 + 让 Agent 按函数/类分段处理
│
└── 任务本身不大，但多轮对话历史累积太长
    └── ✅ 上下文压缩（旧历史摘要化）
```

> **核心原则：把"一次大调用"转化为"多次小调用"，用文件系统（而非上下文窗口）承载中间产出。** CLI 工具天然擅长读写文件，利用好这一点，token 限制基本不再是瓶颈。