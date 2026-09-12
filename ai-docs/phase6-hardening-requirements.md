# Phase 6 · 框架侧加固需求（消费方：idle-path-of-xiuxian）

> 来源：消费方工作区 `/home/nbb/projects/idle-path-of-xiuxian` 的改造计划 M6。
> 由消费方会话撰写，交给**本框架仓库的会话**执行；执行完成后消费方会升级 submodule 并复核。
> 诉求方当前钉在 `d57cada`（已包含“生产守卫可配置 `allowProduction`”）。

## 0. 背景：消费方现状与痛点

消费方是 NestJS 10 + ionet-ts 的单进程服务，WS 以 attach 模式挂在 NestJS 的 `http.Server` 上（`path: '/ws'`）。
它已经落地了 12 个 `@ActionController` 逻辑服、依赖 DAG 门禁、1295 个单元用例与端到端验收。
下列 4 项是它为了“能用/能生产”而不得不绕过的框架缺口，每项都附了**消费方实测证据**。

---

## 1. 通用约束（务必遵守）

- 遵循本仓库 `CLAUDE.md`：
  - 任何代码改动后必须执行并报告 `pnpm -w run build`；
  - 提交信息**严禁** `Co-Authored-By` 署名；
  - 文档中的 `- [ ]` 清单在完成后**必须**回写为 `- [x]`。
- **向后兼容是硬要求**：本仓库其他消费者与 demos 不能被打断。新增字段一律可选，默认行为与现在完全一致。
- 测试：
  - `core-framework` / `external-server`：测试与源码同目录（`src/**/*.test.ts`，根 `vitest.config.ts` 已如此 include）；
  - `extension-nestjs`：测试放 `tests/**/*.test.ts`（该包有独立 `vitest.config.ts`）；
  - 每个包跑 `pnpm --filter <pkg> run test`。
- **每个任务一个独立 commit**，便于消费方按需升级；提交信息用中文简述“做了什么 + 兼容性”。
- 完成后推送到 `origin/dev`，并按下文“交付回报格式”回报。

---

## 2. 任务清单

### 任务 1 · 连接注册表与定向推送（P0-4 / P0-5）

**现状（证据）**
- `packages/external-server/src/websocket/ws-server.ts`：`ClientConnection { ws; isAlive; userId?: bigint }`；
  `sendTo(userId, message)` 遍历 `clients` 比较 `connection.userId === userId`，但**全仓库没有任何地方给 `connection.userId` 赋值** → `sendTo` 恒返回 `false`。
- `packages/core-framework/src/core/flow/flow-context.ts`：`bindingUserId(userId)` 只写 `FlowContext`（与 session）。
- `packages/core-framework/src/core/bar-skeleton.ts`：`execute()` 内部 `new FlowContext()` 并把 ctx 关在闭包内，**外部拿不到本次执行的 userId**。
- `packages/core-framework/src/broadcast/*`：`broadcaster`/`connectionRegistry` 已有实现，但 external-server 未接线。

**目标**
让外部服在“一次成功鉴权的执行”之后，把该连接的 userId 绑定到连接对象，从而使 `sendTo` 可用。

**设计要求**
- 提供一条**不破坏现有 API**的 userId 可见通道，方案任选其一并在提交信息/文档里说明取舍：
  - (a) `BarSkeleton.execute(request, hooks?)`：新增可选 `hooks.onFlowContext?(ctx)`（或 `onBound?(userId)`）；
  - (b) 新增 `executeWithContext()`，返回 `{ response, userId }`；
  - (c) 由外部服注册一个内部 InOut，在 `fuckOut` 时回调外部服（外部服持有 `ctx.getUserId()`）。
- `ws-server` 在 `handleMessage` 中把 `ctx.getUserId()`（`!== 0n` 时）绑定到对应连接；`userId === 0n` **不得绑定**。
- 连接 `close`/`error` 时清除其注册项，避免悬挂。
- `sendTo` 语义：
  - 命中已绑定且 `readyState === OPEN` 的连接 → 发送并返回 `true`；
  - 无命中 → 返回 `false`（**不要**抛错）；
  - **同一 userId 多连接**的策略需明确并在文档中写死（建议：全部发送并返回是否至少命中一个；或最新连接优先——任选，但必须测试锁定）。
- 若框架已有 `broadcast`/`connectionRegistry` 抽象，**优先复用**而不是另起一套。

**测试（`packages/external-server/src/websocket-server.test.ts` 或新增 `src/websocket/*.test.ts`）**
- 绑定后 `sendTo` 命中并返回 true；未绑定返回 false；
- `userId = 0n` 不被绑定；
- 连接关闭后不再命中（注册表已清理）；
- 同一 userId 多连接的行为与所选策略一致；
- 不影响 `broadcast` 既有行为。

---

### 任务 2 · `reqId` 与 `kind` 判别（P0-1 / P0-3）

**现状（证据）**
- 请求信封 `{ cmd, subCmd, data }`；响应信封 `{ data?, errorCode?, errorMessage? }`——**无 cmd 回显、无 reqId、无 kind**（`packages/core-framework/src/protocol/message.ts`）。
- 消费方因此被迫用**串行队列**保证请求-响应配对（`packages/server/scripts/sdk/ws-client.ts`：一次只允许一个在途请求）。
- 广播/通知与响应**无法区分**，消费方只能“有在途请求就当作响应”。

**目标**
支持并行请求配对与响应/通知判别，同时**完全兼容**旧客户端。

**设计要求**
- 请求信封新增**可选** `reqId?: string | number`；响应信封回显同名 `reqId`（请求未带则响应也不带）。
- 响应信封新增 `kind`（建议取值 `'response' | 'notification'`，或等价判别字段）；`createResponseMessage` 相应扩展但不得破坏现有调用签名（新增可选字段）。
- `ws-server` 从请求中读取 `reqId` 并透传到响应；**data 原样透传**，不解析业务。
- 旧客户端（不带 `reqId`）行为与现在**逐字节兼容**（不得因为新增字段而变化）。
- 若同时实现任务 3/4，注意 `reqId` 与 `traceId` 不要混用语义。

**测试（`packages/core-framework/src/protocol.test.ts` 等）**
- 带 `reqId` → 响应回显；不带 → 响应无 `reqId`；
- `kind` 取值正确，且广播消息与响应可被区分；
- JSON codec 往返：新增字段不破坏既有解析；
- `createResponseMessage` 旧调用形式仍编译通过。

---

### 任务 3 · headers/traceId 透传与标准握手鉴权（P0-2 / P1-2）

**现状（证据）**
- `ws-server.ts` 的 `handleMessage` 只取 `{ cmd, subCmd, data }`，**丢弃 `headers`/`traceId`**。
- `packages/core-framework/src/core/flow/flow-context.ts` 的 `Request` 已定义 `headers?`/`traceId?`，但没人填。
- **无握手鉴权**：消费方只能把 JWT 塞进 `data.__token`，由自定义 `WsAuthInOut` 取出并 `bindingUserId`（消费方 `packages/server/src/ionet/ws-auth.inout.ts`）。

**目标**
让 headers/traceId 能到达 `FlowContext`，并提供**可选**的握手鉴权，使业务不必再把令牌放进 data。

**设计要求**
- 透传：`ws-server` 把报文里的 `headers`/`traceId` 填进 `skeleton.execute` 的 request，最终可在 `ctx.getRequest()?.headers` / `traceId` 读到。
- 握手鉴权（**可选、默认关闭**，保证兼容）：
  - `WebSocketExternalServerOptions` 增加如 `authenticate?: (input: { headers; url; protocol? }) => Promise<{ userId: bigint } | null>`；
  - 在 `upgrade`/`connection` 阶段调用：失败则**拒绝升级**（HTTP 401）或立即 close，并给出可诊断日志；
  - 成功则把 userId 绑定到连接，并让该连接上的每次 `execute` 的 `FlowContext` 天然带上该 userId（与任务 1 注册表打通）；
  - `authenticate` 未提供时，行为与现在完全一致。
- 消费方验收目标：升级后其 `WsAuthInOut` 可删除或降级为兜底，改在握手阶段校验 JWT。

**测试**
- 带 `headers`/`traceId` 的请求，Action 内 `ctx.getRequest()?.headers` 能读到；
- `authenticate` 返回 null → 连接被拒（401/立即关闭）；
- `authenticate` 成功 → Action 内 `ctx.getUserId()` 非 0；
- 未配置 `authenticate` → 旧行为不变（`getUserId() === 0n` 除非业务自己绑定）。

---

### 任务 4 · `ActionFactoryBeanForNest`（P1-1）

**现状（证据）**
- `packages/core-framework/src/core/bar-skeleton.ts:44`：`addAction(ActionClass, instance?)` 不传 instance 时**直接 `new ActionClass()`**，业务 Action 拿不到 NestJS 容器依赖。
- `packages/core-framework/src/core/action-factory-bean.ts` 已有 `ActionFactoryBean` / `DefaultActionFactoryBean`，但**全仓库无人使用**。
- 消费方现在用 `packages/server/src/ionet/game-action-bridge.module.ts`（应用内工厂令牌 + `onModuleInit` 手动 `skeleton.addAction(Class, instance)`）绕过。

**目标**
框架提供 Action 实例工厂扩展点，`extension-nestjs` 提供 Nest 适配，使消费方能**删除桥接模块**。

**设计要求**
- `core-framework`：`BarSkeletonBuilder`/`BarSkeleton` 支持自定义工厂（如 `setActionFactory(f: ActionFactoryBean)`）；未设置时**回退 `new`**（行为不变）。
- `extension-nestjs`：Action 作为 Nest provider，工厂从容器解析实例并注册进骨架。
  - ⚠️ **重要陷阱（消费方已实证）**：跨仓库 pnpm workspace 链接下，应用侧与框架侧可能各自解析到**物理上独立的一份 `@nestjs/core`**，类令牌（如 `ModuleRef`/`Reflector`/`HttpAdapterHost`）注入会**静默降级为 `undefined`**。因此工厂实现**不要**依赖跨副本可变的类令牌；建议由应用侧显式传入解析函数（如 `forRoot({ resolveAction: (Cls) => app.get(Cls) })`），或使用 symbol token。
- 消费方验收目标：升级后删除 `game-action-bridge.module.ts`，12 个 Action 仍全部注册进骨架，`e2e:all`/`e2e:journey` 全绿。

**测试（`packages/extension-nestjs/tests/**`）**
- 工厂被调用且每个 Action 只注册一次；
- 容器实例被复用（`get(Cls)` 返回同一对象）；
- 未提供工厂时回退 `new`；
- 与 `forFeature` 组合时的注册顺序正确。

---

## 3. 交付回报格式（框架仓库会话 → 消费方）

每个任务提交后，回报：

    ## 任务 N · <标题>
    - commit: <hash>
    - 改动文件: <列表>
    - 兼容性: <是否向后兼容；新增字段/开关的默认值>
    - 测试: <命令> → <通过数/失败数>
    - 构建: pnpm -w run build → <结果>
    - 消费方升级步骤: <submodule bump 后需要做什么>

全部完成后额外说明：`origin/dev` 的最新 hash、以及是否有任务未完成/降级。

---

## 4. 消费方复核清单（执行完由业务工作区会话做）

- [ ] `git submodule update --remote vendor/ionet-ts`（本地 origin 为 file 路径时需 `-c protocol.file.allow=always`）
- [ ] 重建框架产物 `cd vendor/ionet-ts && pnpm -w run build`
- [ ] 重建本服务 `pnpm --filter ./packages/server build`（**必须重建 dist**，否则验证的是旧产物）
- [ ] `pnpm run verify`（typecheck + typecheck:test + check:deps + test:unit 1295 例）
- [ ] `pnpm run e2e:all` / `pnpm run e2e:journey`
- [ ] 任务 1：新增脚本验证 `sendTo` 定向推送成功/未命中两态
- [ ] 任务 2：SDK 改为 `reqId` 配对（可移除串行队列）并回归
- [ ] 任务 3：鉴权迁到握手 `authenticate`，`WsAuthInOut` 简化或删除
- [ ] 任务 4：删除 `game-action-bridge.module.ts` 并确认 12 个 Action 仍注册（`test/ionet/bridge.test.ts` 需相应调整）

---

## 5. 参考：消费方关键源码位置（便于对照理解）

- 鉴权 InOut：`packages/server/src/ionet/ws-auth.inout.ts`
- 骨架桥接：`packages/server/src/ionet/game-action-bridge.module.ts`
- 路由分配：`packages/server/src/ionet/cmd.ts`
- WS 客户端（串行队列）：`packages/server/scripts/sdk/ws-client.ts`
- 依赖门禁：`packages/server/scripts/lib/dep-rules.ts`
