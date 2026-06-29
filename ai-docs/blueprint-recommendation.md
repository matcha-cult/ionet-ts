# 蓝本推荐：Node.js/TypeScript 移植

## TL;DR

**推荐：以 ionet 为蓝本。**

ioGame 是 ionet 的早期演化版本（v21.34 vs v25.5，包名从 `com.iohao.game` 改为 `com.iohao.net`）。选更新更抽象的版本，避免"先移植旧版、再追平新版"的二次工作。

---

## 对比总表

| 维度 | ionet | ioGame | Node.js 移植影响 |
|---|---|---|---|
| **版本** | 25.5（最新） | 21.34（早期） | ionet 是演进终点 |
| **模块拆分** | 15 个扁平模块 | 5 个顶层模块（common 大而全） | ionet 更利于渐进移植 |
| **代码量** | 76.5k LOC / 736 文件 | 69.6k LOC / 824 文件 | 相当 |
| **跨进程通信** | Aeron + SBE（共享内存 IPC） | SOFA Bolt + ScaleCube | ioGame 略易（无 Aeron 移植难题） |
| **性能上限** | 纳秒级 | 微秒级 | ionet 设计更优 |
| **通信模型** | 6+ 种 | 4 种基础 | ionet 更完整 |
| **AI 知识库支持** | ionet-ai MCP 完整覆盖 | 无专门知识库 | ionet 移植可调用 MCP 查证 |
| **Action 模式** | 完全一致 | 完全一致 | 平手 |
| **FlowContext** | 完全一致 | 完全一致 | 平手 |
| **CmdInfo flyweight** | 完全一致 | 完全一致 | 平手 |
| **Domain Event** | extension-domain-event | light-domain-event | 平手 |
| **Room 抽象** | extension-room | light-game-room | 平手 |
| **Spring 集成** | 独立 extension-spring | 内嵌 common-core | ionet 拆分更干净 |
| **Codegen** | extension-codegen | widget/generate-code | 平手 |
| **JDK 要求** | 25 | 21 | ionet 更激进（record/ZGC） |
| **HTTP 支持** | 无 | external 有 HttpFallbackHandler | ioGame 多一种场景 |

## 推荐理由（按重要性排序）

### 1. ionet-ai MCP 知识库是最大的杠杆

`/home/nbb/projects/ionet-ai/` 提供了完整的 MCP 服务：
- 权威行为查询（"这个 Action 在 XXX 场景下会怎么走？"）
- 知识库分层（stable / candidate / rules）
- Skill 定义覆盖设计、生成、审查、修改等任务族
- 上游事实验证策略（避免移植时猜 Java 原版意图）

**移植过程中可以直接 `mcp__ionet-ai__*` 工具调用查询 ionet 的权威行为**，这对减少移植偏差的价值不可估量。ioGame 没有对等的知识库。

→ **这是决定性优势。** 没有 ionet-ai 的情况下可能要考虑 ioGame，有了它就没什么好犹豫的。

### 2. 模块拆分决定了移植路径

ionet 的 15 个模块可以直接映射为 TS monorepo 的 15 个包：
```
@ionet/common-kit
@ionet/core-framework
@ionet/net-common
@ionet/net-center
@ionet/net-server
@ionet/net-logic-server
@ionet/external-core
@ionet/external-netty → @ionet/external-node (用 Node 原生替换 Netty)
@ionet/run-one
@ionet/extension-client
@ionet/extension-codegen
@ionet/extension-domain-event
@ionet/extension-jprotobuf → @ionet/extension-protobuf (用 protobufjs)
@ionet/extension-room
@ionet/extension-spring → @ionet/extension-nest (用 NestJS)
```

ioGame 的 5 个顶层模块在移植时需要**先内部拆分**再移植，等于多做一次重构。

### 3. 通信模型更完整

ionet 比 ioGame 多的通信模型：
- `request/multiple-response` —— 同时请求同类所有逻辑服
- `OnExternal` —— 逻辑服反向调用外部服
- 更精细的 EventBus 语义

这些在大型游戏中都是刚需。如果以 ioGame 为蓝本，未来还是要回来加。

### 4. ionet 是演进终点

从 git 历史和包名变化看，ionet 是 ioGame 团队做的"下一代"设计：
- 包名从 `com.iohao.game` → `com.iohao.net`（更抽象）
- Aeron 替换 Bolt（性能跃迁）
- 模块拆分更细（职责清晰化）
- 升级到 JDK 25（用最新语言特性）

选旧版本做蓝本 = 主动放弃这些改进。

## 唯一倾向 ioGame 的场景

如果项目满足以下全部条件，可以考虑 ioGame：
1. 不需要纳秒级延迟（微秒级就够）
2. 不打算用 ionet-ai MCP
3. 团队对 Aeron 完全陌生且不愿学
4. 项目时间紧，想要最快能跑的"基础版"

但即便如此，也建议直接从 ionet 开始，然后**跳过 Aeron 部分**（第一版只用单进程 worker_threads）。

## Node.js 移植的关键技术决策（待 Phase 1 前确认）

### 决策 1：Aeron 怎么处理？

**推荐方案：分阶段**
- **Phase 1-3**：完全不用 Aeron，单进程跑，跨模块用 Node `EventEmitter` + `AsyncLocalStorage`
- **Phase 4+**：引入跨进程时，用以下之一替代 Aeron：
  - `zeromq` / `nanomsg`（最接近 Aeron 的 IPC 语义）
  - `node-addon-api` 封装 Aeron C++（性能最优，构建最复杂）
  - `shared-memory` + `Atomic`（worker_threads 内）

### 决策 2：Action 装饰器

```typescript
@ActionController(HallCmd.cmd)
class HallAction {
  @ActionMethod(HallCmd.loginVerify)
  loginVerify(jwt: string, ctx: FlowContext): UserMessage {
    ctx.bindingUserId(Math.abs(hashCode(jwt)));
    return { id: userId, nickname: jwt };
  }
}
```

需要 `reflect-metadata` + `ts-experiment-decorators`。

### 决策 3：FlowContext 等价物

Node.js 的 `AsyncLocalStorage` 天然对应 FlowContext。每个请求绑定一个 ALS 实例。

### 决策 4：DI 框架

三选一：
- **无 DI**（最接近 ionet 精神）：手写工厂
- **TSyringe / InversifyJS**：轻量 DI
- **NestJS**：完整 Spring 等价物（对应 `extension-spring` → `extension-nest`）

→ 推荐：core 不用 DI，提供可选 `@ionet/nest` 适配 NestJS。

### 决策 5：协议层

- 默认 Protobuf（`protobufjs`）
- 可选 JSON
- `@ProtobufClass` → `@ProtobufClass()` 装饰器 + `protobufjs` 代码生成

## 风险点

| 风险 | 影响 | 缓解 |
|---|---|---|
| Aeron 无 Node 等价物 | 跨进程延迟变大 | 第一版先不实现跨进程 |
| Java record → TS 没有等价物 | 路由性能下降 | 用普通对象 + Map 缓存 |
| Java 反射 → TS 装饰器 | 元数据能力较弱 | 用 `reflect-metadata` + 显式注册补强 |
| Lombok → TS 无对应 | 模板代码变多 | 用 TS 装饰器（`@Field`）或 constructor 直接赋值 |
| Disruptor 在 Node 单线程下无意义 | 需要重新设计 | 用 Promise 队列 + EventEmitter |
| ionet-ai MCP 对 TS 移植的覆盖不足 | 遇到 TS 特有问题无法查证 | 在 ionet-ai 中增加 TS 移植相关的 stable 资产 |

## 推荐路线图

```
Phase 0 (当前)      分析与决策 ← 已完成
  ↓
Phase 1             核心骨架：Action/FlowContext/CmdInfo 最小可运行版
  ↓
Phase 2             External：WS/TCP 接入 + 会话管理
  ↓
Phase 3             分布式基础：Logic Server + 单进程内 IPC
  ↓
Phase 4             扩展生态：Protobuf / Domain Event / Room
  ↓
Phase 5 (ongoing)   Codegen / Nest 集成 / Trace / 压测工具
```

每个 Phase 的详细任务清单应该在进入该 Phase 前制定，避免提前过度设计。
