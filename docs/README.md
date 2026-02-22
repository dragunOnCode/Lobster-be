# Lobster - 多Agent群聊式协作编码系统

> 智能、协作、高效的AI编码助手平台  
> 版本：v1.0.0  
> 日期：2026-02-18

---

## 📚 文档导航

### 核心文档

1. **[技术选型方案.md](./技术选型方案.md)** - 完整的技术栈选型和对比分析
2. **[模块需求设计.md](./模块需求设计.md)** - 8个核心模块的详细需求规格
3. **[系统架构设计.md](./系统架构设计.md)** - 整体系统架构和组件关系
4. **[OpenClaw架构分析与对比.md](./OpenClaw架构分析与对比.md)** - 深度分析OpenClaw并对比
5. **[组件实现清单与路线图.md](./组件实现清单与路线图.md)** - 4周开发计划和实施指南

### 实施计划

6. **[迭代开发计划.md](./迭代开发计划.md)** - 4个Sprint的详细迭代计划和里程碑
7. **[Sprint1-详细任务看板.md](./Sprint1-详细任务看板.md)** - Sprint 1（第1-2周）MVP基础 ✅ 已完成
8. **[Sprint2-详细任务看板.md](./Sprint2-详细任务看板.md)** - Sprint 2（第3-4周）多Agent协作核心

### 补充文档

9. **[Agent配置说明.md](./Agent配置说明.md)** - Agent配置文件格式和使用指南
10. **[系统核心特性说明.md](./系统核心特性说明.md)** - 核心特性和使用技巧
11. **[架构可视化图表.md](./架构可视化图表.md)** - 系统架构的可视化图表和时序图
12. **[数据库Schema设计.md](./数据库Schema设计.md)** - 完整的数据库表结构设计

---

## 🎯 项目概述

### 什么是Lobster?

Lobster是一个**多Agent群聊式协作编码系统**，多个AI Agent（Claude、Codex、Gemini）像真实团队成员一样在共享工作空间中协作完成编码任务。

**核心特点**：
- 🤖 **群聊式交互**：Agent像人类团队一样自由对话
- 💡 **主动感知**：Agent智能判断何时参与讨论
- 🏷️ **@提及召唤**：使用@Claude、@Codex直接召唤
- 💾 **共享记忆**：所有Agent共享上下文，无需重复
- 📁 **共享工作空间**：代码、文档、任务全员可见
- 🔄 **实时协作**：Agent可以互相评论和改进

### 使用场景

```
场景1：快速原型开发
用户: @Claude 实现一个Todo应用
Claude: 好的，我来设计架构和代码...（生成代码）
Gemini: 我觉得UI可以用渐变色...（主动建议）
Codex: 代码不错，建议添加输入验证...（主动审查）
👉 3个Agent自发协作，无需用户协调

场景2：代码审查优化
用户: @Codex 审查这段代码
Codex: 发现3个问题...（详细分析）
Claude: 我来修复Codex提到的问题...（主动修复）
👉 Agent之间互相配合

场景3：设计驱动开发
用户: 设计一个用户中心页面
Gemini: 我设计了线框图和配色方案...
Claude: 根据Gemini的设计，我实现了代码...
👉 设计到实现无缝衔接
```

---

## 🏗️ 技术架构

### 核心技术栈

```yaml
后端:
  - 框架: NestJS 10+
  - 语言: TypeScript 5+
  - 实时通信: Socket.io 4+
  - AI编排: LangGraph

Agent调用:
  - Claude: OpenRouter API (架构设计编码)
  - Codex: CLI调用 (代码审查)
  - Gemini: CLI调用 (创意设计)

存储:
  - 数据库: PostgreSQL 16+
  - 缓存: Redis 7+
  - 向量: ChromaDB
  - 文件: 本地FS + MinIO

前端:
  - 框架: Vue 3
  - 实时: Socket.io Client
```

### 架构模式（借鉴OpenClaw）

**Hub-and-Spoke架构**：

```
前端Vue ← WebSocket → Gateway(Hub) ↔ Agent(Spoke)
                         ↓
                   Memory + Workspace
```

**关键组件**：
1. **Gateway（Hub）**：单一入口，管理所有连接和会话
2. **Agent Layer（Spoke）**：多个Agent并行工作
3. **Memory Layer**：三层记忆（短期/长期/共享）
4. **Workspace**：文件系统存储（可审计）

---

## 🌟 核心特性

### 1. @提及召唤

```
用户: @Claude 实现登录功能
      👆 Claude必定响应

用户: @Codex @Gemini 你们看看这个设计
      👆 两个Agent都会响应
```

### 2. Agent主动感知

```
用户: 我想优化性能
[系统]: Claude决定响应（涉及代码优化）
[系统]: Codex决定响应（涉及性能分析）
Claude: 我建议添加缓存...
Codex: 我发现了性能瓶颈...
```

### 3. 共享工作空间

```
Workspace (会话abc-123)
├── 📁 code/
│   ├── UserController.ts (Claude创建)
│   └── LoginPage.vue (Claude+Gemini协作)
├── 📋 tasks.md
│   ├── ✅ 实现登录 (Claude完成)
│   └── 🔄 添加测试 (Codex进行中)
└── 📚 docs/
    └── architecture.md (Claude编写)

所有Agent和用户都能看到和编辑！
```

### 4. 智能记忆管理

```
三层记忆架构:
┌──────────────────────┐
│ 短期记忆 (5分钟)     │ ← 最近20条消息
├──────────────────────┤
│ 长期记忆 (永久)      │ ← 完整历史 + 向量检索
├──────────────────────┤
│ 共享记忆 (实时)      │ ← 任务、代码、决策
└──────────────────────┘
```

### 5. 文件系统审计（借鉴OpenClaw）

```jsonl
{"timestamp":"2026-02-18T10:00:00Z","type":"message","role":"user","content":"实现登录"}
{"timestamp":"2026-02-18T10:00:05Z","type":"agent_decision","agent":"claude","decision":"respond"}
{"timestamp":"2026-02-18T10:01:00Z","type":"file_created","path":"UserController.ts","author":"claude"}
```

所有操作都有记录，可审计、可追溯！

---

## 📖 快速开始

### 阅读顺序（新手）

1. **先读**：[系统核心特性说明.md](./系统核心特性说明.md) - 了解系统能做什么
2. **再读**：[技术选型方案.md](./技术选型方案.md) - 了解为什么选这些技术
3. **后读**：[系统架构设计.md](./系统架构设计.md) - 了解整体架构
4. **详读**：[模块需求设计.md](./模块需求设计.md) - 了解每个模块的细节
5. **最后读**：[组件实现清单与路线图.md](./组件实现清单与路线图.md) - 开始动手

### 阅读顺序（技术决策者）

1. **先读**：[OpenClaw架构分析与对比.md](./OpenClaw架构分析与对比.md) - 了解架构设计依据
2. **再读**：[技术选型方案.md](./技术选型方案.md) - 评估技术选型
3. **后读**：[系统架构设计.md](./系统架构设计.md) - 评审整体架构

### 阅读顺序（开发者）

1. **先读**：[组件实现清单与路线图.md](./组件实现清单与路线图.md) - 了解开发计划
2. **再读**：[模块需求设计.md](./模块需求设计.md) - 了解具体需求
3. **边读边做**：[Agent配置说明.md](./Agent配置说明.md) - 配置Agent

---

## 💻 技术栈一览

### 后端

| 分类 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **核心框架** | NestJS | 10+ | Web框架 |
| **语言** | TypeScript | 5+ | 类型安全 |
| **实时通信** | Socket.io | 4+ | WebSocket |
| **数据库** | PostgreSQL | 16+ | 主数据库 |
| **缓存** | Redis | 7+ | 热状态 |
| **向量库** | ChromaDB | latest | 语义检索 |
| **对象存储** | MinIO | latest | 文件存储 |
| **任务队列** | BullMQ | latest | 异步任务 |
| **AI编排** | LangGraph | latest | 工作流 |
| **ORM** | TypeORM | 0.3+ | 数据库ORM |

### Agent调用

| Agent | 模型 | 调用方式 | 用途 |
|-------|------|---------|------|
| **Claude** | claude-3-sonnet | OpenRouter API | 架构设计编码 |
| **Codex** | codex | CLI | 代码审查 |
| **Gemini** | gemini-pro | CLI | 创意设计 |

### 前端

| 分类 | 技术 | 版本 |
|------|------|------|
| **框架** | Vue 3 | latest |
| **实时** | Socket.io Client | 4+ |
| **状态** | Pinia | latest |
| **UI库** | Element Plus | latest |

---

## 📈 开发进度

### 第1周：MVP核心

```
□ Gateway基础框架
□ 3个Agent Adapter
□ PostgreSQL Schema
□ 文件系统工作空间
□ 基础消息收发

目标：能跑起来
```

### 第2周：核心功能

```
□ Agent决策引擎
□ @提及解析
□ 流式响应
□ Redis记忆层
□ Config热重载
□ Transcript日志

目标：群聊式协作完整可用
```

### 第3周：优化增强

```
□ Cron定时任务
□ 向量检索
□ 记忆摘要
□ 工作流编排

目标：生产可用
```

### 第4周：部署上线

```
□ 认证授权
□ 安全加固
□ 监控告警
□ 文档完善

目标：可上线
```

---

## 🎯 核心设计决策

### 决策1：为什么选NestJS？

✅ **理由**：
- 与Java/Spring Boot高度相似（便于学习）
- 企业级架构（依赖注入、模块化）
- TypeScript原生支持
- WebSocket内置支持
- 社区活跃

### 决策2：为什么借鉴OpenClaw？

✅ **理由**：
- 成熟的Hub-and-Spoke架构
- 文件系统审计日志（可追溯）
- Config热重载（开发友好）
- 插件化设计（可扩展）
- 实战验证（生产环境稳定）

### 决策3：为什么采用群聊模式？

✅ **理由**：
- 更自然的交互方式
- Agent可以互相学习
- 减少用户协调成本
- 提高协作效率

### 决策4：为什么共享工作空间？

✅ **理由**：
- 避免上下文重复
- 提高协作效率
- 所有成员信息同步
- 减少沟通成本

---

## 🚀 快速命令

### 初始化项目

```bash
# 安装NestJS CLI
npm install -g @nestjs/cli

# 创建项目
cd backend
nest new . --package-manager npm

# 安装依赖
npm install @nestjs/websockets socket.io @nestjs/typeorm typeorm pg redis ioredis @nestjs/bull bull @nestjs/schedule chokidar
```

### 启动开发环境

```bash
# 启动依赖服务
docker-compose up -d

# 启动开发服务器
npm run start:dev
```

### 测试Agent调用

```bash
# 测试Claude (OpenRouter)
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{"model":"anthropic/claude-3-sonnet","messages":[{"role":"user","content":"Hello"}]}'

# 测试Gemini CLI
gemini-cli --prompt "Hello" --format json

# 测试Codex CLI
codex-cli --prompt "审查代码" --format json
```

---

## 📊 系统对比

### Lobster vs 传统AI助手

| 特性 | 传统AI助手 | Lobster |
|------|-----------|---------|
| **交互方式** | 一问一答 | 群聊协作 |
| **Agent数量** | 单个 | 多个同时在线 |
| **上下文** | 需重复 | 自动共享 |
| **协作方式** | 无 | Agent互相对话 |
| **工作空间** | 无 | 共享代码仓库 |
| **可扩展性** | 固定 | 动态添加Agent |

### Lobster vs OpenClaw

| 特性 | OpenClaw | Lobster |
|------|----------|---------|
| **架构** | Hub-and-Spoke | ✅ 相同 |
| **交互模式** | 一对一 | ✅ 群聊 |
| **工作空间** | 多个隔离 | ✅ 单个共享 |
| **Agent协作** | 独立 | ✅ 互相对话 |
| **平台** | 多平台（WhatsApp等） | Web专注 |

---

## 🎨 设计亮点

### 1. 智能决策引擎

Agent不会无脑响应每条消息：

```
用户: 今天天气真好
[所有Agent: 不响应]

用户: 优化一下代码
[Claude: 响应 - 涉及代码优化]
[Codex: 响应 - 涉及性能]
[Gemini: 不响应 - 与设计无关]
```

### 2. 文件系统审计（OpenClaw启发）

所有操作记录到JSONL，永久可追溯：

```jsonl
{"type":"message","user":"张三","content":"实现登录"}
{"type":"agent_decision","agent":"claude","decision":"respond"}
{"type":"file_created","path":"UserController.ts","author":"claude"}
{"type":"agent_decision","agent":"codex","decision":"respond","reason":"检测到新代码"}
{"type":"message","agent":"codex","content":"代码审查通过"}
```

### 3. Config热重载（OpenClaw启发）

修改配置文件 → 自动重载 → 无需重启：

```bash
# 开发时调整Agent配置
vim config/agents.config.json
# 修改temperature: 0.7 → 0.8
# 保存

[NestJS] 📝 配置文件变更
[NestJS] ✅ Agent重载完成 (45ms)
[前端] 系统通知：配置已更新
```

---

## 🔧 核心模块

### 1. Gateway模块（Hub）

**职责**：
- WebSocket连接管理
- 消息路由
- 会话管理
- 配置热重载

**关键代码**：`src/gateway/chat.gateway.ts`

### 2. Agent模块（Spoke）

**职责**：
- 统一调用接口
- 3个Agent实现
- 决策引擎
- 健康检查

**关键代码**：`src/agents/`

### 3. Workspace模块（OpenClaw风格）

**职责**：
- 文件系统操作
- Transcript日志
- 会话导出

**关键代码**：`src/workspace/workspace-fs.service.ts`

### 4. Memory模块

**职责**：
- 短期记忆（Redis）
- 长期记忆（PostgreSQL）
- 共享记忆（Redis + 文件）
- 记忆摘要

**关键代码**：`src/memory/`

### 5. Chat模块

**职责**：
- 消息处理
- @提及解析
- 流式推送
- 房间管理

**关键代码**：`src/chat/chat.service.ts`

---

## 📐 数据流

### 典型消息流（端到端）

```
1. 用户在前端输入: "@Claude 实现登录"
   ↓
2. Socket.io发送到Gateway
   ↓
3. Gateway解析@提及，保存消息
   ↓
4. 广播给所有Agent（并行）
   ├─ Claude.shouldRespond() → Yes (被@)
   ├─ Codex.shouldRespond() → No
   └─ Gemini.shouldRespond() → Maybe (涉及UI)
   ↓
5. Claude和Gemini开始生成（并行）
   ↓
6. 流式推送到前端（实时显示）
   ↓
7. 保存到数据库 + Redis + 文件系统
   ↓
8. Codex检测到新代码，主动审查
   ↓
9. 完整的协作完成
```

---

## 🛠️ 开发环境

### 环境要求

```yaml
必需:
  - Node.js: >=20.0.0
  - npm: 内置
  - PostgreSQL: >=16.0
  - Redis: >=7.0

可选:
  - Docker: >=24.0
  - Docker Compose: >=2.20
```

### Docker Compose

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: lobster
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes:
      - redis_data:/data

  chromadb:
    image: chromadb/chroma:latest
    ports: ["8000:8000"]
    volumes:
      - chroma_data:/chroma/chroma

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  redis_data:
  chroma_data:
  minio_data:
```

---

## 📚 核心概念

### Agent角色分工

| Agent | 角色 | 何时响应 | 示例 |
|-------|------|---------|------|
| **Claude** | 架构师+工程师 | 编码、设计、重构 | "实现XX功能" |
| **Codex** | 审查员 | 代码审查、测试 | "审查代码" |
| **Gemini** | 设计师 | UI/UX、创意 | "设计界面" |

### 会话模式

| 模式 | 说明 | 使用场景 |
|------|------|---------|
| **自由对话** | Agent自由决策 | 探索性讨论、灵活协作 |
| **结构化工作流** | 固定流程 | 完整功能开发、标准流程 |

### 记忆类型

| 类型 | 存储 | TTL | 用途 |
|------|------|-----|------|
| **短期** | Redis | 5分钟 | 最近对话 |
| **长期** | PostgreSQL | 永久 | 完整历史 |
| **共享** | Redis+文件 | 1小时 | 协作状态 |

---

## 🎓 参考资源

### 官方文档

- [NestJS中文文档](https://docs.nestjs.cn/)
- [Socket.io文档](https://socket.io/docs/v4/)
- [LangGraph文档](https://langchain-ai.github.io/langgraph/)
- [OpenClaw文档](https://openclaw-ai.online/)

### 学习资源

- OpenClaw架构深度分析（Medium）
- Multi-Agent Best Practices（OpenAI）
- LangGraph Production Guide（LangChain）

---

## 📞 技术支持

### 常见问题

**Q: Agent响应慢怎么办？**
A: 
1. 检查CLI是否正常工作
2. 增加超时时间
3. 查看Agent健康状态
4. 检查网络连接

**Q: 记忆占用太多怎么办？**
A:
1. 启用自动摘要（Cron任务）
2. 调整短期记忆TTL
3. 定期清理过期会话
4. 使用向量检索代替全文检索

**Q: 如何添加新Agent？**
A:
1. 编辑 `config/agents.config.json`
2. 添加Agent配置
3. （可选）实现自定义Adapter
4. 重启或等待热重载

**Q: 如何调试Agent决策？**
A:
1. 查看 `transcripts.jsonl` 的决策记录
2. 检查Agent的 `decisionRules.keywords`
3. 调整 `autoRespondThreshold` 阈值
4. 添加调试日志

---

## 🏆 系统优势

### 技术优势

1. ✅ **成熟架构**：借鉴OpenClaw实战验证的设计
2. ✅ **类型安全**：TypeScript端到端
3. ✅ **高性能**：Redis缓存 + 异步处理
4. ✅ **可扩展**：插件化设计
5. ✅ **易运维**：Config热重载、文件审计

### 业务优势

1. ✅ **自然交互**：群聊式，而非命令式
2. ✅ **高效协作**：Agent主动配合
3. ✅ **上下文共享**：无需重复解释
4. ✅ **灵活扩展**：动态添加Agent
5. ✅ **完整审计**：所有操作可追溯

---

## 📝 下一步行动

### 立即开始

1. **阅读文档**：按推荐顺序阅读所有文档
2. **准备环境**：安装Node.js、PostgreSQL、Redis
3. **初始化项目**：运行 `nest new backend`
4. **配置Agent**：获取API密钥、安装CLI工具
5. **开始编码**：按照[组件实现清单](./组件实现清单与路线图.md)开发

### 需要帮助？

- 📖 查看详细文档
- 🐛 遇到问题记录到Issues
- 💬 技术讨论参考OpenClaw社区

---

## 📄 文档版本历史

- **v1.0.0** (2026-02-18): 初始版本
  - 完成技术选型
  - 完成模块设计
  - 完成架构设计
  - OpenClaw深度分析
  - 实施路线图

---

## 📜 许可证

MIT License

---

**项目状态**: 📝 设计阶段  
**下一里程碑**: 🚀 开始编码（Week 1）

---

## 联系方式

- 项目: Lobster
- 仓库: (待创建)
- 文档: d:\Project\Lobster\backend\

---

**让我们开始构建一个真正智能的多Agent协作系统！** 🚀
