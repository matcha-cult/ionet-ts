# ionet-ai MCP 在移植工程中的价值

## MCP 是什么

`/home/nbb/projects/ionet-ai/` 是 ionet 项目的**本地 AI 知识库**，提供：
- Python 实现的 MCP 服务器（`src/ionet_ai/mcp_server.py`）
- 三层知识结构：stable（稳定资产）/ candidate（候选）/ rules（强制规则）
- 多类 Skill：design / generate / modify / review / install 等

## 对 Node.js 移植的直接价值

### 1. 行为查证（最重要的用途）

移植 Java → TypeScript 时最大的风险是"猜 Java 原版意图"。ionet-ai MCP 可以：

- 查询某个 Action 在特定场景下的权威行为
- 验证 FlowContext 的某个方法在边界条件下的表现
- 确认 Plugin/InOut 的调用顺序和时机
- 查证 CmdInfo 的 flyweight 缓存在什么情况下失效

**调用方式（假设已配置 MCP）**：
```
mcp__ionet-ai__ask_intent("FlowContext.bindingUserId 重复调用会怎样？")
mcp__ionet-ai__search_source("ActionCommandRegion 的注册时机")
```

### 2. 设计对照

移植不是逐行翻译，而是保留设计意图换实现方式。ionet-ai 有：
- `stable/concepts/` —— 核心概念定义
- `stable/conventions/` —— 强制约定
- `stable/architecture-decisions/` —— 架构决策记录
- `stable/patterns/` —— 实现模式

在 TS 中重新设计某个功能时，可以先查 ionet 的"为什么要这么做"，再决定 TS 里怎么做。

### 3. 代码审查

移植完一个模块后，可以用 ionet-ai 的 `review-ionet-code` skill 审查：
- 是否偏离了 ionet 的设计意图
- 是否引入了不必要的 Java 思维
- 是否漏掉了边界处理

### 4. 知识库反哺

移植过程中发现的 TS 特有问题（AsyncLocalStorage 行为、装饰器限制、protobufjs 边界）可以**回写到 ionet-ai 知识库**，形成"ionet TS 移植"的稳定资产，后续维护者受益。

## 移植前应该做的 MCP 准备工作

1. **确认 ionet-ai MCP 已在本机启动**
   ```bash
   cd /home/nbb/projects/ionet-ai
   cat docs/user-installation.md  # 看启动说明
   ```

2. **在 TS 项目中配置 MCP 客户端**
   新建的 TS 项目 `.mcp.json` 指向 ionet-ai server，开发时随时查询。

3. **预读 ionet-ai 的关键资产**
   在动手写代码前，建议先读完：
   - `skill-defs/design-server-boundary/` —— 服务器边界设计
   - `skill-defs/generate-action-feature/` —— Action 功能生成规则
   - `stable/concepts/` —— 所有核心概念
   - `stable/conventions/` —— 所有强制约定
   - `rules/` —— 所有强制规则

## 当前 ionet-ai 对 TS 移植的覆盖缺口

ionet-ai 当前主要服务"用 ionet 写业务"的开发者，**不是为"移植 ionet 到 TS"设计的**。以下知识可能需要新建：

- [ ] TS 装饰器 vs Java 注解的能力差异边界
- [ ] AsyncLocalStorage 与 FlowContext 的语义等价性分析
- [ ] protobufjs vs JProtobuf 的行为差异
- [ ] Node.js EventEmitter vs ionet EventBus 的语义映射
- [ ] worker_threads / cluster vs ionet 多线程模型
- [ ] Aeron IPC 在 Node.js 中的可选替代方案对比

建议在 Phase 0 收尾时，把这些作为新 stable 资产贡献给 ionet-ai。

## 相关链接

- ionet-ai README：`/home/nbb/projects/ionet-ai/README.md`
- 安装文档：`/home/nbb/projects/ionet-ai/docs/user-installation.md`
- Skill 定义：`/home/nbb/projects/ionet-ai/skill-defs/`
- 任务分类图：`/home/nbb/projects/ionet-ai/docs/task-taxonomy-map.md`
