# 逻辑服运行时 —— TS 移植缺口证据包（来自 idle-dark-forever）

> **用途**：`idle-dark-forever`（Node/NestJS + ionet-ts 的游戏工程）要求把单体服务按逻辑服拆开
> （battle / map / dungeon / item / quest / character + 对外服）。经审计，**ionet-ts 目前没有逻辑服运行时**，
> 因此该工程当前**只能做单进程内的逻辑服边界**，跨进程部署被阻塞。
>
> 本文是**框架侧需求证据**：只列事实（含文件与行号）与所需能力，供框架仓库另开会话实施。
> 本文由 `idle-dark-forever` 会话写入，**未提交**；框架侧可自行取舍、拆分与提交（提交信息禁 `Co-Authored-By`）。
>
> 判定依据：ionet 官方知识库 `ionet-ai`（`rules/`+`stable/` 为权威层）+ Java 原版 `ionet/` + 本仓 TS 源码实测。

---

## 0. 一句话结论

TS 移植实现的是「**N 个完全相同的对外服实例 + Redis 会话/广播/房/锁**」，
**不是**「1 个对外服 + N 个逻辑服」：没有 `LogicServer` 宿主、没有服务器元数据/注册表、
没有跨逻辑服 `call/send`、没有 `OnExternal`、没有多响应收集；`extension-nestjs` 里
`redis` 只负责 `connect()`，广播恒为进程内 `MemoryBroadcaster`。
→ 消费方无法把战斗/地图/秘境/物品/任务/角色拆成独立逻辑服进程。

---

## 1. 证据：核心框架侧（逐条可复核）

| # | 现状 | 证据位置 |
|---|---|---|
| E1 | `grep LogicServer\|logic-server\|ServerBuilder\|settingBarSkeletonBuilder\|serverId` 在 `packages/*/src` 与 `demos/**` **零命中** | 全仓 grep |
| E2 | `BarSkeleton` 是**进程内** Action 宿主，`execute()` 本地调用；无 server id/name/tag | `packages/core-framework/src/core/bar-skeleton.ts:90-137` |
| E3 | `FlowContext` **没有**任何跨服方法（无 `call/send/forward`）；只有 userId/cmdInfo/request/response/server/session/attachments | `packages/core-framework/src/core/flow/flow-context.ts`（169 行） |
| E4 | `FlowContext.ServerInfo` 的 `setServer/getServer` **存在但无人调用**（仅 `AccessLogInOut` 读） | `flow-context.ts:21,128`；`flow/internal/access-log-inout.ts:40` |
| E5 | 外部服**直接本地执行**：`HttpExternalServer.handleRequest` → `this.skeleton.execute(...)`；WS 同理 | `packages/external-server/src/http/http-server.ts:81`；`websocket/ws-server.ts:273` |
| E6 | 路由表仅本地：`ActionCommandRegions.getActionCommand(cmdInfo)`；全局重复检查 `ActionCommandRegionGlobalCheckKit` 只吃**内存数组** | `core-framework/src/core/action-command-region.ts`；`core/kit/global-check.ts` |
| E7 | `packages/redis` 只有 pub/sub + 状态 + 锁，**没有 request/reply**：grep `reply\|rpc\|correlation\|pending` 零命中 | `packages/redis/src/**` |
| E8 | `extension-nestjs` 的 `redis?: RedisClientOptions \| false`——**不接受 `true`**；只 `connect()/disconnect()`，未接 session、未接广播 | `extension-nestjs/src/ionet.interfaces.ts:22`；`ionet.module.ts:185-194,330,373` |
| E9 | 广播恒为进程内：`createBroadcasterProvider()` 永远返回 `createMemoryBroadcaster(...)`；`DistributedBroadcasterDecorator` 从未构造 | `extension-nestjs/src/ionet.module.ts:47-59` |
| E10 | `demo-cluster` = **多实例对外服**（每个进程都挂全部 Action），跨实例逻辑只在 demo 的应用层 Redis 频道里 | `demos/demo-cluster/src/main.ts`、`src/game/game-server.ts` |
| E11 | `deploy/ecosystem.config.js` = PM2 3 个**相同**实例；`docker-compose` `replicas:3`——无角色划分 | `deploy/**` |

## 2. 证据：Java 原版已有对应物（可对照移植）

| 能力 | Java 位置 |
|---|---|
| `LogicServer` 接口（`settingBarSkeletonBuilder`/`settingServerBuilder`/`startupSuccess`） | `ionet/net-server/src/main/java/com/iohao/net/server/LogicServer.java` |
| 逻辑服进程启动 | `ionet/net-logic-server/.../logic/LogicServerApplication.java` |
| 逻辑服注册表 | `ionet/net-server/.../LogicServerManager.java` |
| 服务器元数据（id/name/tag/cmdMerges/ip） | `ionet/core-framework/.../protocol/ServerBuilder.java` |
| 聚合启动 `RunOne` | `ionet/run-one/.../app/RunOne.java` |
| 跨服同步/异步/回调调用 | `ionet/core-framework/.../communication/LogicCommunication.java`、`FutureManager` |
| 多响应收集 `callCollect` | `ionet/core-framework/.../communication/LogicCollectCommunication.java`、`ResponseCollect` |
| 逻辑服→对外服 `OnExternal` | `ionet/external-core/.../net/external/OnExternal.java`、`OnExternalManager`、`ExternalCommunication` |
| 分布式事件总线 | `ionet/core-framework/.../communication/eventbus/**` |
| 路由/负载均衡/发现 | `ionet/net-server/.../cmd/CmdRegions.java`、`balanced/LogicServerLoadBalanced.java`、`DefaultFindServer.java`；`ionet/net-center/**` |

---

## 3. 需要补充的运行时能力（按依赖顺序）

> 每条给出：**缺口 / 阻塞了消费方的什么 / 建议落点 / 验收**。

### RS1 `LogicServer` 宿主抽象（P0）
- **缺口**：能启动一个"只注册 Action、不监听客户端端口"的逻辑服进程。
- **阻塞**：消费方无法把 battle/map/dungeon/item/quest/character 拆成独立进程；只能单进程。
- **建议落点**：新包 `packages/logic-server`（或 `core-framework` 内），提供
  `LogicServer` 接口（两个 builder 方法 + 可选 `startupSuccess`）与 `LogicServerApplication.startup(...)`。
- **验收**：可启动一个无端口逻辑服；与外部服**分进程**跑通一条 Action 调用（此时可先走临时直连，RS4 再补 RPC）。
- **KB 约束**：命名 `*LogicServer`、放模块根包、只做 builder 配置、**不得写业务**（`rules/logic-server-rules.md`）。

### RS2 服务器元数据 + 注册/发现（P0）
- **缺口**：`serverId/name/tag/serverType/cmdMerges/ip` 与心跳注册表；现有 `InstanceManager`
  只有自由 `metadata`，且从未被路由查询。
- **阻塞**：外部服不知道有哪些逻辑服、各自负责哪些 cmd 段。
- **建议落点**：扩展 `packages/redis/src/instance-manager.ts` 或新增 `ServerRegistry`（Redis）。
- **验收**：多进程启动 → 注册/发现/下线；`cmdMerge → 逻辑服` 可查。

### RS3 分布式路由表（P0）
- **缺口**：`cmdMerge → 逻辑服` 的路由与负载均衡；TS 路由表是进程内的。
- **阻塞**：外部服收到请求后无法转发到逻辑服。
- **建议落点**：`core-framework` 的分布式 `ActionCommandRegions` + Redis 注册表；
  `BarSkeleton.execute` 或代理 `ActionCommand` 里做转发。
- **验收**：外部服收请求 → 转发 → 回包；**未注册路由必须显式报错**（不得静默 404 掩盖）。
- **⚠️ 约束**：Java `DefaultLogicServerLoadBalanced` 明文「同一 `cmdMerge` 只保留一个 owner，
  注册第二个会替换、不轮询」。**因此不能靠 cmdMerge 做分片**；同类型多实例的分片需要
  应用级 affinity（见 RS4/消费方说明）。

### RS4 跨进程请求/响应 RPC（P0）
- **缺口**：Redis 只有 fire-and-forget；**没有** correlation id / pending future / 超时 / 去重。
- **阻塞**：逻辑服之间（battle↔map/dungeon↔character↔item↔quest）无法同步调用。
- **建议落点**：`packages/redis` 新增 `RedisRequestReply` + `FutureManager`。
- **验收**（**必须覆盖失败路径**）：超时、对端崩溃、重复回包、乱序、大 payload。
- **注意**：KB `communication-logic-call-api-contract.md` 明确"**不得推断**事务/重试/投递保证/精确一次"；
  TS 实现须显式声明自身保证（建议：至多一次 + 超时错误，不承诺顺序）。

### RS5 `FlowContext` 跨服 API（P0）
- **缺口**：`call` / `callAsync` / `send`（以及可选的 `callCollect`）。
- **阻塞**：Action 内无法调用另一个逻辑服。
- **落点/验收**：`core-framework/src/core/flow/flow-context.ts` 增方法 + 契约测试。

### RS6 逻辑服→对外服反向通道 `OnExternal` + 跨进程连接可见性（P0）
- **缺口**：`OnExternal` 等价物；跨进程"某 userId 连在哪个实例"的连接注册表
  （现有 `connectionRegistry` 是进程内的，`MemoryBroadcaster` 看不到别的进程）。
- **阻塞**：battle 产出的 `(world,tick)` 帧等推送无法跨进程送到用户连接。
- **建议落点**：接线已有的 `DistributedBroadcasterDecorator` + 实现 `OnExternal` 式通道。
- **验收**：逻辑服触发推送 → 连接在**另一个**进程的用户能收到；实例宕机不静默丢帧。

### RS7 `extension-nestjs` 分布式接线（P0）
- **缺口**：`redis` 只 connect；广播恒内存；无 `RedisSessionStore` 注入；`redis` 不接受 `true`。
- **阻塞**：NestJS 应用无法开启跨实例推送/会话。
- **建议落点**：`extension-nestjs/src/ionet.interfaces.ts`、`ionet.module.ts`。
- **验收**：配置开启后广播/会话走 Redis，且**单实例行为不变**（向后兼容）。

### RS8 跨进程重复路由检测（P1）
- 把注册表来源的 `cmdMerge` 区域喂给 `ActionCommandRegionGlobalCheckKit`，启动期检出跨进程路由冲突。

### RS9 多响应收集 `callCollect` / 分布式 EventBus（P2，可选）
- 消费方当前**不需要**：不做分片 collect，也不做分布式事件总线（先用命令 + 单向事件 + `send`）。

---

## 4. 明确**不需要**的能力（免得做多）

- **room（房间）模型**：消费方已评估并**明确不采用**（成员恒 1、无多人；room 路由/范围投递/空房回收
  在 Java 与 TS 都不存在，自建成本 > 收益）。**不要**为消费方补 `RangeBroadcast`/房间注册表/room→实例路由。
- **多线程/worker 模型**：消费方是单线程事件循环，按会话分片调度即可。
- **Center Server / Aeron**：TS 移植已选择 Redis 路线（`migration-strategy.md`），消费方接受该选择。

## 5. 消费方当前的部署方式（框架就绪前的过渡）

- **单进程内**按逻辑服划分模块边界：`<server>/logic-server.ts`（仅 builder）+ Action 包 + 单向依赖 + 无环门禁。
- 逻辑服之间先走**进程内事件/端口**（接口面向未来的跨服调用设计），框架就绪后替换实现即可。
- 消费方接受"**框架就绪前不跨进程**"，其容量上限由单实例准入 + 增量推送 + 批量落库承担。

---

## 6. 给框架会话的建议实施顺序

```
RS1 LogicServer 宿主
  → RS2 元数据/注册表 → RS3 分布式路由 → RS4 Redis RPC → RS5 FlowContext.call/send
  → RS6 OnExternal + 跨进程连接可见性 → RS7 extension-nestjs 接线
  → RS8 重复路由检测；（RS9 可选）
每条都要有：多进程集成测试 + 失败路径测试（超时/对端崩溃/未注册路由/重复回包）。
```

> 复核入口：本文所有证据均可用一条 grep 或一次源码阅读复核；行号以写入时的 `dev` 分支为准。
