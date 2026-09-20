# ionet vs ioGame 蓝本选型分析

本目录记录把 ionet / ioGame 这两个 Java 游戏服务器框架移植为 Node.js/TypeScript 版之前的蓝本选型分析。

## 文档索引

| 文件 | 内容 |
|---|---|
| [migration-strategy.md](./migration-strategy.md) | **迁移策略**（网络协议、部署模式、技术栈选择） |
| [ionet-analysis.md](./ionet-analysis.md) | ionet 仓库的深度分析（架构、模块、代码量、并发模型、扩展机制） |
| [iogame-analysis.md](./iogame-analysis.md) | ioGame 仓库的深度分析（同上维度） |
| [blueprint-recommendation.md](./blueprint-recommendation.md) | 两者对比 + Node.js 移植蓝本推荐 + 关键决策点 |
| [mcp-assets.md](./mcp-assets.md) | ionet-ai MCP 知识库对移植工程的辅助价值 |
| [phase1-core-skeleton.md](./phase1-core-skeleton.md) | **Phase 1 详细任务清单**（类级别映射 + 验收标准） |
| [phase2-external-server.md](./phase2-external-server.md) | **Phase 2 详细任务清单**（External Server 抽象 + 验收标准） |
| [phase2-review.md](./phase2-review.md) | **Phase 2 回顾**（架构决策、测试覆盖、性能指标） |
| [phase3-distributed.md](./phase3-distributed.md) | **Phase 3 详细任务清单**（Redis IPC 分布式通信） |
| [phase3-review.md](./phase3-review.md) | **Phase 3 回顾**（架构决策、测试覆盖、文件清单） |
| [phase4-extensions.md](./phase4-extensions.md) | **Phase 4 详细任务清单**（Domain Event、Protobuf、Codegen、NestJS 集成） |
| [phase5-preset-logic.md](./phase5-preset-logic.md) | **Phase 5 详细任务清单**（预制逻辑服抽象类） |
| [phase5-review.md](./phase5-review.md) | **Phase 5 回顾**（交付清单、设计决策、测试覆盖） |
| [port-consolidation-3in1.md](./port-consolidation-3in1.md) | **端口三合一方案**（:3001/:3002 并入 :3000） |
| [port-consolidation-3in1-feasibility.md](./port-consolidation-3in1-feasibility.md) | **三合一可行性评估** |

## 任务跟踪（超长期）

> 每完成一项手动勾选 `[x]`。未完成的不打勾。

### Phase 0 · 分析与决策 ✅ 完成

- [x] 克隆 ionet（已完成，位于 `ionet/`）
- [x] 克隆 ioGame（已分析后删除，决策不再需要）
- [x] 深度分析 ionet 架构 → `ionet-analysis.md`
- [x] 深度分析 ioGame 架构 → `iogame-analysis.md`
- [x] 蓝本推荐 → `blueprint-recommendation.md`
- [x] 与用户确认蓝本选择 → **决定：以 ionet 为蓝本**
- [x] 制定 Phase 1 详细任务清单 → `phase1-core-skeleton.md`
- [x] 确定技术栈 → **pnpm workspaces + tsup + vitest + reflect-metadata**
- [x] 确定包名前缀 → **`@nbb-ionet/*`**
- [x] 搭建 TS monorepo 脚手架 → `packages/` 目录结构

### Phase 1 · 核心骨架 ✅ 完成

- [x] `@ActionController` / `@ActionMethod` 的 TS 装饰器等价物
- [x] `CmdInfo` 路由（cmd + subCmd 合并 + flyweight）
- [x] `FlowContext` 请求上下文（AsyncLocalStorage 集成）
- [x] Action 扫描与注册（DefaultActionCommandParser）
- [x] BarSkeleton 运行时 + InOut 插件系统
- [x] 最小可运行的单进程 demo

详细回顾见 `packages/core-framework/docs/phase1-review.md`

### Phase 2 · External Server ✅ 完成

详细任务清单见 [phase2-external-server.md](./phase2-external-server.md)

- [x] ProtocolCodec 抽象 + JSON 编解码
- [x] HTTP External Server
- [x] WebSocket External Server
- [x] FlowContext 扩展（Session, ServerInfo, Attachments）
- [x] InOut 插件扩展（SessionInOut, AccessLogInOut, RateLimitInOut）
- [x] 集成 Demo（双协议同时运行）
- [x] 81 tests passing

详细回顾见 [phase2-review.md](./phase2-review.md)

### Phase 3 · Redis IPC 分布式通信 ✅ 完成

详细任务清单见 [phase3-distributed.md](./phase3-distributed.md)

- [x] Redis 基础设施
  - [x] `@nbb-ionet/redis` 包
  - [x] RedisClient 封装
  - [x] 连接池管理
- [x] Redis Pub/Sub 消息系统
  - [x] 跨进程消息发布/订阅
  - [x] 消息路由器
  - [x] 消息类型定义
- [x] 分布式 Session 管理
  - [x] RedisSessionStore
  - [x] 会话序列化（bigint / Map）
  - [x] TTL 支持
- [x] 分布式广播系统
  - [x] DistributedBroadcaster
  - [x] 用户-实例映射
  - [x] 消息路由
- [x] 分布式房间系统
  - [x] DistributedRoom
  - [x] 房间状态同步
  - [x] 房间消息路由
- [x] 分布式锁
  - [x] DistributedLock
  - [x] Lua 脚本原子操作
  - [x] Watchdog 自动续期
- [x] 多实例部署配置
  - [x] 实例标识与注册（支持 INSTANCE_ID 环境变量）
  - [x] 优雅关闭 GracefulShutdown
  - [x] 多种部署方式示例（PM2/Docker/systemd/K8s）
- [x] 集成 Demo
  - [x] `demos/demo-cluster/` 多实例场景
  - ⚠️ 石头剪刀布 demo：案例选型错误（客户端驱动），但已验证 Redis Pub/Sub、状态存储、跨实例通信的连通性
- [x] 78 tests passing

详细回顾见 [phase3-review.md](./phase3-review.md)

### Phase 4 · 扩展 ✅ 完成

详细任务清单见 [phase4-extensions.md](./phase4-extensions.md)

- [x] Protobuf 编解码（`@nbb-ionet/extension-jprotobuf`）
  - [x] `@ProtobufClass` / `@ProtobufField` 装饰器
  - [x] ProtobufProtocolCodec 实现
  - [x] 8 tests passing
- [x] Domain Event（`@nbb-ionet/extension-domain-event`）
  - [x] DomainEventBus 并发隔离
  - [x] 按 roomId/userId 分区串行处理
  - [x] 12 tests passing
- [x] Codegen（`@nbb-ionet/extension-codegen`）
  - [x] Action 扫描器
  - [x] TypeScript / C# / GDScript / Lua 代码生成
  - [x] 6 tests passing
- [x] NestJS 集成（`@nbb-ionet/extension-nestjs`）
  - [x] IonetModule forRoot/forFeature
  - [x] Action 自动扫描与依赖注入
  - [x] 11 tests passing
- [x] 房间扩展（DistributedRoomExtended）
  - [x] 房间属性动态修改
  - [x] 成员角色（owner/admin/member）
  - [x] 房间消息历史
  - [x] 房间搜索与列表
  - [x] 事件钩子（onRoomCreate/Destroy/UserJoin/UserLeave/Message）
  - [x] 16 tests passing
- [x] 集成 Demo 与文档
  - [x] demo-codegen 代码生成示例
  - [x] phase4-review.md 回顾文档

详细回顾见 [phase4-review.md](./phase4-review.md)

### Phase 5 · 预制逻辑服 ✅ 完成

详细任务清单见 [phase5-preset-logic.md](./phase5-preset-logic.md)

预制逻辑服抽象类（需继承后使用）：

- [x] 用户系统
  - [x] AbstractAuthAction（登录认证）
  - [x] AbstractUserAction（用户管理）
  - [x] AbstractMultiRoleUserAction（多角色用户）
- [x] 物品系统
  - [x] AbstractItem（物品基类）
  - [x] AbstractBagAction（背包系统）
  - [x] AbstractEquipAction（装备系统）
- [x] 社交系统
  - [x] AbstractMailAction（邮件系统）
  - [x] AbstractRoom（抽象房间）
  - [x] AbstractGameRoom（抽象游戏房间）
- [x] 放置系统
  - [x] AbstractIdleAction（放置类游戏）
- [x] 文档和示例
  - [x] 使用文档
  - [x] 完整示例项目
  - [x] phase5-review.md 回顾文档

---

## 结论速览（详见 blueprint-recommendation.md）

**推荐：以 ionet 为蓝本。**

主要理由：

1. **模块拆分更清晰** —— 15 个模块各司其职，TS 移植时可按模块渐进落地
2. **代码量略大但结构更干净** —— 76.5k LOC vs ioGame 的 69.6k LOC，但 ioGame 的 `common` 一个模块就塞了 396 个文件
3. **ionet-ai MCP 知识库** —— 移植过程中可直接调用 ionet-ai 的 MCP 服务查询框架权威行为，显著降低移植时的"猜 Java 原版意图"风险
4. **更新、更激进的技术栈** —— JDK 25 + record + Aeron 1.49，设计时已考虑现代 JVM 特性，抽象更接近"应该的样子"而非历史包袱
5. **演进关系** —— ionet 是 ioGame 的后继演化版本（看包名从 `com.iohao.game` 变为 `com.iohao.net`），选最新版本作为蓝本更合理

ioGame 的唯一优势：传输层用 SOFA Bolt + Netty（没有 Aeron），理论上移植到 Node.js 时少一个"无 Node 对等物"的痛点。但 Aeron 的缺失也让 ioGame 丧失了 ionet 的核心价值（纳秒级延迟、零拷贝 IPC）。
