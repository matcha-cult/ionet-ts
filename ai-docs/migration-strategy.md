# ionet-ts 迁移策略

**创建日期**：2026-07-02  
**最后更新**：2026-07-02

---

## 核心原则

### 1. 符合 Node.js 特性

- **单线程事件循环**：充分利用 Node.js 的非阻塞 I/O 和事件驱动特性
- **异步优先**：所有 I/O 操作使用 async/await
- **轻量级**：避免过度设计，保持代码简洁

### 2. 使用 ionet 的设计思想

保留 ionet 的核心概念：

| 概念 | 说明 | TS 实现 |
|------|------|---------|
| Action | 业务逻辑载体 | `@ActionController` / `@ActionMethod` |
| FlowContext | 请求上下文 | `FlowContext` 类 |
| CmdInfo | 路由键 | `CmdInfo` record |
| BarSkeleton | 业务运行时 | `BarSkeleton` 类 |
| InOut | 插件系统 | `ActionMethodInOut` 接口 |

### 3. 不照搬 Java 实现

- **不使用 Aeron**：Node.js 没有对等的共享内存 IPC
- **不使用 MethodHandle**：TypeScript 直接用函数引用
- **不使用 Spring**：使用 NestJS 作为可选集成
- **不使用 JSR380**：使用 Zod 或其他 JS 验证库

---

## 网络通信策略

### ✅ 实现

| 协议 | 状态 | 说明 |
|------|------|------|
| HTTP | ✅ 已实现 | `HttpExternalServer`（Phase 2） |
| WebSocket | ✅ 已实现 | `WebSocketExternalServer`（Phase 2） |

### ❌ 不实现

| 协议 | 原因 |
|------|------|
| TCP | Node.js Web 场景不常用，增加复杂度 |
| UDP | 不适合 Web 应用，可靠性问题 |
| 其他自定义协议 | 不符合 Node.js 生态 |

### 设计理由

- HTTP 和 WebSocket 是 Web 应用最常用的协议
- Node.js 生态中 HTTP/WS 支持成熟（Express、ws、socket.io）
- TCP/UDP 更多用于底层服务或专用游戏服务器，不属于 Web 框架范畴
- 保持框架简洁，专注于核心功能

---

## 部署模式策略

### 现阶段：单进程模式

```
┌─────────────────────────────────────────────┐
│           单进程部署（当前）                  │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │     External Server                 │   │
│  │  ┌──────────┐  ┌───────────────┐   │   │
│  │  │   HTTP   │  │  WebSocket    │   │   │
│  │  │  :8080   │  │    :9080      │   │   │
│  │  └────┬─────┘  └───────┬───────┘   │   │
│  └───────┼─────────────────┼───────────┘   │
│          │                 │               │
│          └────────┬────────┘               │
│                   ▼                        │
│          ┌────────────────┐                │
│          │  BarSkeleton   │                │
│          │  (业务运行时)   │                │
│          └────────┬───────┘                │
│                   │                        │
│          ┌────────┴────────┐               │
│          ▼                 ▼               │
│    ┌──────────┐      ┌──────────┐         │
│    │ 登录逻辑 │      │ 聊天逻辑 │         │
│    └──────────┘      └──────────┘         │
│                                             │
│  内存 Session | 内存房间 | 内存广播          │
└─────────────────────────────────────────────┘
```

**特点**：
- ✅ 简单、快速、易调试
- ✅ 使用内存存储（Session、房间、广播）
- ✅ 不需要 Redis
- ✅ 适合开发、测试、小规模生产

### 后续演进：PM2 3 集群模式

```
┌─────────────────────────────────────────────┐
│         PM2 3 集群部署（后续）                │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │Instance 0│  │Instance 1│  │Instance 2│  │
│  │HTTP :8080│  │HTTP :8081│  │HTTP :8082│  │
│  │WS   :9080│  │WS   :9081│  │WS   :9082│  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │             │             │         │
│       └─────────────┼─────────────┘         │
│                     │                       │
│               ┌─────┴─────┐                 │
│               │   Redis   │                 │
│               │  Pub/Sub  │                 │
│               │  Session  │                 │
│               │   Room    │                 │
│               └───────────┘                 │
└─────────────────────────────────────────────┘
```

**特点**：
- ✅ PM2 cluster 模式，自动负载均衡
- ✅ Redis 作为 IPC 通信层（Phase 3 已实现）
- ✅ Redis 存储 Session、房间状态
- ✅ 适合中等规模生产

### ❌ 不做：分布式集群部署

| 模式 | 原因 |
|------|------|
| Kubernetes 多副本 | 复杂度高，运维成本大 |
| 跨机房部署 | 网络延迟问题，需要更复杂的同步机制 |
| Aeron IPC | Node.js 没有对等的共享内存 IPC |
| Center Server | 单进程 + PM2 已足够 |

---

## 技术栈选择

### 核心依赖

| 类别 | 选择 | 理由 |
|------|------|------|
| 运行时 | Node.js 20+ | LTS 版本，稳定 |
| 语言 | TypeScript 5+ | 类型安全，开发体验好 |
| HTTP | 原生 `http` 模块 | 轻量，无依赖 |
| WebSocket | `ws` 库 | 高性能，社区成熟 |
| 序列化 | JSON / Protobuf | JSON 开发调试，Protobuf 生产性能 |
| 测试 | Vitest | 快速，兼容 Jest API |
| 构建 | tsup | 简单，支持 ESM/CJS |

### 可选依赖

| 类别 | 选择 | 使用场景 |
|------|------|----------|
| NestJS | `@nestjs/common` | 企业级项目集成 |
| Redis | `ioredis` | PM2 集群模式 |
| 验证 | `zod` | 请求参数验证 |
| 日志 | `pino` | 高性能日志 |

---

## Phase 规划

| Phase | 内容 | 状态 | 单进程价值 |
|-------|------|------|------------|
| Phase 1 | 核心骨架 | ✅ 完成 | ✅ 核心 |
| Phase 2 | External Server（HTTP + WS） | ✅ 完成 | ✅ 核心 |
| Phase 3 | Redis IPC 分布式通信 | ✅ 完成 | ⚠️ 后续 PM2 用 |
| Phase 4 | 扩展（Protobuf、Domain Event、Codegen、NestJS） | ✅ 完成 | ✅ 部分有用 |
| Phase 5 | 预制逻辑服（Auth、User、Bag、Equip、Mail、Room 等） | 📝 规划中 | ✅ 核心 |

### Phase 3 的定位

Phase 3 实现了 Redis IPC 分布式通信，但**现阶段单进程模式不需要**：

- ✅ 代码已实现，可用于后续 PM2 集群模式
- ⚠️ 单进程模式下，使用内存存储（Session、房间、广播）
- ⚠️ 不需要启动 Redis，简化部署

**单进程模式下的替代方案**：

| 功能 | 分布式（Phase 3） | 单进程（当前） |
|------|------------------|---------------|
| Session 存储 | `RedisSessionStore` | `MemorySessionStore` |
| 房间管理 | `DistributedRoom` | `MemoryRoom` |
| 广播系统 | `DistributedBroadcaster` | `MemoryBroadcaster` |
| 分布式锁 | `DistributedLock` | 不需要（单进程无竞争） |

---

## 业务逻辑实现

### 现阶段目标

在单进程模式下实现核心业务逻辑：

1. **登录逻辑**
   - JWT 验证
   - Session 创建
   - userId 绑定到 FlowContext

2. **聊天逻辑**
   - 发送消息到房间
   - 房间广播
   - 私聊消息

3. **房间逻辑**
   - 创建房间
   - 加入/离开房间
   - 房间列表

### 实现原则

- ✅ 使用内存存储（简单、快速）
- ✅ 不依赖外部服务（Redis、数据库等）
- ✅ 符合 Node.js 异步特性
- ✅ 完整的单元测试覆盖

---

## 总结

### 做什么

- ✅ HTTP + WebSocket 网络通信
- ✅ 单进程部署模式
- ✅ 内存存储（Session、房间、广播）
- ✅ 登录、聊天、房间等核心业务逻辑
- ✅ 后续 PM2 3 集群模式

### 不做什么

- ❌ TCP / UDP 网络通信
- ❌ 分布式集群部署（Kubernetes、跨机房）
- ❌ Aeron IPC（Node.js 无对等物）
- ❌ Center Server（单进程 + PM2 已足够）

### 演进路径

```
单进程（内存） → PM2 3 集群（Redis） → 后续优化
     ↓                ↓
  当前阶段          未来演进
```

---

## 参考资料

- [ionet 原版分析](./ionet-analysis.md)
- [ioGame 原版分析](./iogame-analysis.md)
- [蓝本推荐](./blueprint-recommendation.md)
- [Phase 1 回顾](../packages/core-framework/docs/phase1-review.md)
- [Phase 2 回顾](./phase2-review.md)
- [Phase 3 回顾](./phase3-review.md)
- [Phase 4 回顾](./phase4-review.md)
