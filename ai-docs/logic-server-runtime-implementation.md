# 逻辑服运行时 —— TS 移植实施记录（RS1–RS8）

> 对应需求证据包：`ai-docs/logic-server-runtime-requirements.md`（idle-dark-forever 写入）。
> 本文是框架侧实施记录：落点、设计取舍、验收与失败路径测试。任务清单随实施勾选。

## 0. 结论

TS 移植从「N 个相同的对外服实例」补齐为「**1 对外服 + N 逻辑服**」：

- 新增包 `@nbb-ionet/logic-server`：`LogicServer` 宿主、服务器元数据/注册表、分布式路由、
  `OnExternal` 反向通道、跨进程重复路由检测、对外服分布式运行时接线；
- `core-framework`：跨服通信抽象（`CrossServerRouter` / `CommunicationKit`）与
  `FlowContext.call/callAsync/send`，`BarSkeleton` 本地未命中时转发；
- `redis`：`RedisRequestReply`（RPC）、`ServerRegistry`、`ConnectionRegistryStore`、
  `RedisOnExternalTransport`，并接线既有 `DistributedBroadcasterDecorator`；
- `external-server`：`OnExternal` handler 注册/分发、连接上下线观测钩子；
- `extension-nestjs`：`redis: true` 与 registry/router/分布式广播/会话/OnExternal 接线。

**明确不做**：room 房间模型与范围广播、Center Server、Aeron、`callCollect`、分布式 EventBus（RS9）。

## 1. 架构

```
客户端 ──WS──▶ 对外服进程（BarSkeleton 无本地 Action）
                  │  BarSkeleton.execute：本地未命中 → CrossServerRouter.forward
                  ▼
        Redis 注册表（ServerRegistry: cmdMerge → logic 实例）
                  │  RedisRequestReply（{prefix}rpc:{instanceId}，correlationId/超时/去重）
                  ▼
        逻辑服进程（LogicServerHost：只注册 Action、无客户端端口）
                  │  FlowContext.call/callAsync/send → 再路由到其它逻辑服
                  │  ctx.setServer(本逻辑服元数据)
                  ▼
        跨进程推送：DistributedBroadcasterDecorator（连接归属表 + 定向通道）
        反向操作：OnExternal（forceOffline/existUser）经定向通道或 RPC
```

投递保证（显式声明，KB `communication-logic-call-api-contract` 要求不得静默推断）：
**至多一次**，不重试、不承诺顺序；超时抛 `RpcTimeoutError`（上层按存活状态细分为
`PEER_OFFLINE`），对端 handler 报错回 `RpcPeerError`，重复/迟到回包去重并告警。

## 2. 任务清单（RS1–RS8）

- [x] **RS1 `LogicServer` 宿主（无客户端端口）**
  - 落点：`packages/logic-server/src/logic-server.ts`（`LogicServer` 接口，两个 builder + 可选
    `startupSuccess`）、`src/logic-server-host.ts`（`LogicServerHost.start` / `startLogicServer`）。
  - 验收：多进程集成测试中逻辑服进程无监听端口，经 Redis RPC 承接对外服转发。
- [x] **RS2 服务器元数据 + 注册/发现（Redis）**
  - 落点：`packages/logic-server/src/server-builder.ts`、`packages/redis/src/server-registry.ts`
    （`{prefix}servers` hash + `{prefix}servers:events`，心跳/超时下线/`findServerByCmdMerge`）。
  - 验收：注册/发现/下线的多进程断言；`cmdMerge → 逻辑服` 可查。
- [x] **RS3 分布式路由（未注册路由显式报错）**
  - 落点：`core-framework` `CrossServerRouter` + `BarSkeleton` 未命中回退；
    `packages/logic-server/src/redis-logic-router.ts`（同 cmdMerge 单 owner，不做轮询）。
  - 验收：转发回包；未注册路由返回 **503 `NOT_REGISTERED`**（非静默 404）。
- [x] **RS4 Redis 请求/响应 RPC（correlation id / pending / 超时 / 去重）**
  - 落点：`packages/redis/src/redis-request-reply.ts`。
  - 验收：正常回包、无 handler、handler 抛错、超时、重复回包去重、迟到回包、单向 send；
    多进程对端崩溃 → `PEER_OFFLINE`。
- [x] **RS5 `FlowContext` 跨服 API**
  - 落点：`core-framework/src/core/communication/**` + `FlowContext.call/callAsync/send/sendAsync`
    （支持 `(cmd, subCmd, …)` 与 `(CmdInfo, …)`）；未配置通信时抛 `NOT_CONFIGURED`。
  - 验收：契约单测 + 多进程 battle→map 同步调用、单向 send、Action 绑定 userId 跨进程回传。
- [x] **RS6 `OnExternal` + 跨进程连接可见性**
  - 落点：`core-framework/src/external/on-external.ts`（接口/注册表/显式报错）；
    `packages/redis/src/connection-registry-store.ts`、`on-external-transport.ts`；
    `DistributedBroadcasterDecorator`（连接归属表 + 定向通道，归属实例离线显式抛错）；
    `external-server`（默认 `forceOffline`/`existUser` handler + `setConnectionObserver`）。
  - 验收：逻辑服推送跨进程送达；OnExternal 强制下线关闭连接；对外服崩溃推送显式
    `CONNECTION_OWNER_OFFLINE`（不静默丢帧）。
- [x] **RS7 `extension-nestjs` 分布式接线**
  - 落点：`ionet.interfaces.ts`（`redis: RedisClientOptions | true | false`、`distributed`、
    `session`）、`ionet.module.ts`（`IONET_EXTERNAL_RUNTIME`/`IONET_REDIS_PUB_SUB`/
    `IONET_SESSION_STORE` provider；`ExternalServerRuntime` 接线；`SessionInOut` 走 Redis）。
  - 验收：开启后广播为 `DistributedBroadcasterDecorator`、骨架有跨服路由器、会话为
    `RedisSessionStore`；关闭时 `MemoryBroadcaster`、无路由器、无 Redis 会话（向后兼容）。
- [x] **RS8 跨进程重复路由检测**
  - 落点：`core-framework` `ActionCommandRegionGlobalCheckKit.detectGlobalDuplicateCmdMerges`
    （喂注册表 cmdMerge 区域）+ `logic-server/src/cross-process-duplicate-check.ts`，
    `LogicServerHost.start` 默认在启动期执行。
  - 验收：第二个逻辑服承接已注册 cmdMerge 时启动即失败（退出码 1，报错含
    `Duplicate routes detected across processes`）。
- [ ] **RS9 `callCollect` / 分布式 EventBus（可选，消费方当前不需要）** —— 未实施。

## 3. 包与文件落点

| 包 | 新增/改动 |
|---|---|
| `@nbb-ionet/core-framework` | `core/communication/{types,communication-kit,index}.ts`；`core/external/on-external.ts`；`FlowContext` 跨服方法；`BarSkeleton` 转发回退 + `setCrossServerRouter`；`ActionCommandRegions.listCmdMerges`；`global-check` cmdMerge 版；`ConnectionObserver` |
| `@nbb-ionet/redis` | `redis-request-reply.ts`、`server-registry.ts`、`connection-registry-store.ts`、`on-external-transport.ts`；`distributed-broadcaster-decorator.ts`（定向通道/宕机报错）；`redis-pub-sub` 实例 id |
| `@nbb-ionet/external-server` | `BaseExternalServer.onExternal/handleOnExternal`；`WebSocketExternalServer` 默认 handler + `setConnectionObserver` |
| `@nbb-ionet/logic-server`（新） | `logic-server.ts`、`server-builder.ts`、`logic-server-host.ts`、`redis-logic-router.ts`、`external-communication.ts`、`external-server-runtime.ts`、`cross-process-duplicate-check.ts`、`protocol.ts` |
| `@nbb-ionet/extension-nestjs` | `ionet.interfaces.ts`、`ionet.module.ts`、`ionet.constants.ts`、`index.ts` |

## 4. 验收与测试

多进程集成测试（**2 逻辑服进程 + 1 对外服进程 + 真实 Redis**）：
`packages/logic-server/src/integration/cluster.integration.test.ts`（14 例）
- RS1/RS3 对外服无本地 Action → 跨进程转发；RS2 注册/发现/下线；
- RS5 battle→map 同步调用、单向 send、userId 跨进程绑定；
- RS3 未注册路由显式 503；
- RS4 超时 504、对端崩溃 502 `PEER_OFFLINE`、优雅下线 503 `NOT_REGISTERED`；
- RS6 跨进程推送、OnExternal 强制下线、连接上下线登记、实例宕机显式报错；
- RS8 重复路由启动失败。

失败路径单测：`packages/redis/src/redis-request-reply.test.ts`（超时/重复回包/迟到回包/无 handler）、
`packages/core-framework/src/communication.test.ts`（未配置/未注册/超时映射）、
`packages/redis/src/distributed-broadcaster-targeted.test.ts`（归属未知/离线）。
RS7 接线测试：`packages/extension-nestjs/tests/distributed-wiring.test.ts`。

运行方式（子进程经 `node --import tsx` 加载本包源码，依赖包须先构建）：

```bash
pnpm -w run build

# 多进程集成（需本机 Redis 127.0.0.1:6379；可用 IONET_TEST_REDIS_PORT 指定）
pnpm --filter @nbb-ionet/logic-server run test
pnpm --filter @nbb-ionet/redis run test
pnpm --filter @nbb-ionet/core-framework run test
pnpm --filter @nbb-ionet/external-server run test
pnpm --filter @nbb-ionet/extension-nestjs run test
```

## 5. 消费方接入要点

- 逻辑服进程：实现 `XxxLogicServer implements LogicServer`（两个 builder，`settingBarSkeletonBuilder`
  配置 Action，`settingServerBuilder` 设 name/tag），用 `startLogicServer({ logicServer, redisClient,
  pubSub, keyPrefix })` 启动；**无客户端端口**。
- Action 内：`ctx.call / callAsync / send`；`ctx.getServer()` 可读执行方逻辑服元数据；
  逻辑服侧推送用 `host.broadcaster`，对连接下指令用 `host.externalCommunication`。
- 对外服：`ExternalServerRuntime.start({ server, wsServer, redisClient, pubSub, skeleton })`（NestJS
  经 `IonetModule.forRoot({ redis: {...} | true })` 自动接线）；本地未命中的路由自动转发。
- 部署约束（RS3）：同一 `cmdMerge` 只能有一个 owner（与 Java
  `DefaultLogicServerLoadBalanced` 一致，不做轮询）；同类型多实例分片需应用级 affinity（`call`
  的 `tag` 选项）。
