# ionet-ts 线协议规格（PROTOCOL）

> 本文件是 ionet-ts 对外线协议的**唯一规格**。源码为准、逐条可核对；
> 实现位置：`packages/core-framework/src/protocol/`、`packages/external-server/src/websocket/ws-server.ts`、
> `packages/external-server/src/http/http-server.ts`、`packages/core-framework/src/broadcast/`、
> `packages/extension-codegen/src/`。

## 0. 概览

ionet-ts 提供两条等价的 Action 传输通道，路由与响应信封同构：

| 通道 | 实现 | 面向 |
|---|---|---|
| WebSocket | `WebSocketExternalServer`（基于 `ws`） | 实时双向、服务端主动推送 |
| HTTP | `HttpExternalServer` | 弱网/代理/不支持 WS 的降级兜底 |

两条通道都只认 `(cmd, subCmd)` 路由与统一信封；客户端语言无关。

---

## 1. 连接与路径（WebSocket）

- 默认路径 `/ws`（`WebSocketExternalServerOptions.path`）。
- 两种部署形态：
  - **独立模式**：给出 `port`，自起 listener。日志形如 `WebSocket External Server listening on ws://0.0.0.0:<port>/ws`。
  - **attach 模式**：给出 `server`（共享既有 `http.Server`，如 NestJS 应用），WS upgrade 挂在同一 listener，可单端口三合一。
- 帧类型：**文本帧**，UTF-8 JSON（默认 codec）。服务端 `data.toString()` 后解码。
- 客户端连接地址：`ws(s)://<host>[:port]/ws`（以实际部署为准）。

---

## 2. 编解码 SPI

```ts
interface ProtocolCodec<T = unknown> {
  encode(data: T): Uint8Array | string;
  decode(buffer: Uint8Array | string): T;
  readonly contentType: string;
}
```

- 默认 `JsonProtocolCodec`（`application/json`，文本帧）。
- 可插拔：`ExternalServerOptions.codec` 注入；`extension-jprotobuf` 提供 `application/x-protobuf` 二进制实现。
  换 codec 只改传输层编解码，信封字段语义不变。
- 二进制实现的跨端机器可读 schema 清单见 §13（P2-1）。

---

## 3. 请求信封（客户端 → 服务端）

```jsonc
{
  "cmd": 30,            // 必须：路由主命令
  "subCmd": 1,          // 必须：路由子命令
  "data": { },          // 可选：业务载荷
  "headers": { },       // 可选：透传给 FlowContext 的头部（如 traceId、灰度标签）
  "traceId": "...",     // 可选：全链路追踪 id
  "reqId": "r-1"        // 可选：客户端请求配对 id（string | number），新协议启用
}
```

- 类型定义：`core-framework/src/protocol/message.ts` 的 `RequestMessage` / `createRequestMessage`。
- `headers` 与 `traceId` 会透传到 `FlowContext`，Action 内可经 `ctx.getRequest()?.headers / traceId` 读取。
- 服务端只依赖 `cmd/subCmd` 路由；`data` 形状由业务 Action 决定。

---

## 4. 响应信封（服务端 → 客户端）

```jsonc
{
  "data": { },              // 成功 payload
  "errorCode": 0,           // 0 / 缺失 = 成功
  "errorMessage": "...",    // 失败原因
  "reqId": "r-1",           // 仅当请求携带 reqId 时回显
  "kind": "response"        // 仅当请求携带 reqId 时写入
}
```

- 类型定义：`ResponseMessage` / `createResponseMessage`。
- **响应不回显 `cmd/subCmd`**（`BarSkeleton.execute` 只返回 `{data}` 或 `{errorCode, errorMessage}`）。
- `reqId` 与 `kind` 的出现条件是**请求携带 `reqId`**（新协议）。旧客户端（不带 `reqId`）的响应逐字节不变：
  仅 `{data?, errorCode?, errorMessage?}`，`reqId`/`kind` 键不出现。
- `kind` 取值域：`'response' | 'notification'`（`ResponseKind`）。

### 4.1 请求关联（reqId）

同一连接上可并发多个未决请求：客户端为每个请求生成 `reqId`，服务端在响应中原样回显。
不带 `reqId` 的客户端无法关联响应，只能串行请求（兼容旧行为）。

---

## 5. 推送信封（服务端主动 → 客户端）

```jsonc
{
  "kind": "notification",   // 必须：判别字段
  "type": "room.tick",      // 可选：事件名（与 cmd/subCmd 并列）
  "cmd": 100,               // 可选：按 cmd/subCmd 路由时给出
  "subCmd": 1,
  "data": { },              // 推送载荷
  "timestamp": 1700000000000, // 可选：框架规范化路径会补当前时刻
  "headers": { },           // 可选
  "reqId": "r-1",           // 可选：语义上对应某请求时回显
  "fromUserId": "42"        // 可选：广播来源（Broadcaster 路径保留）
}
```

- **唯一构造入口**：`createNotificationMessage()`（`core-framework/src/protocol/message.ts`）。
  仅显式给出的可选字段才写入；因此 `kind` 之外的字段集可裁剪。
- 客户端据 `kind` 与响应确定区分：
  - `kind === 'response'`：某次请求的响应，按 `reqId` 配对。
  - `kind === 'notification'`：服务端主动推送，按 `cmd/subCmd` 或 `type` 路由。
- 服务端规范化推送入口（均经 `createNotificationMessage`）：
  - `WebSocketExternalServer.broadcastNotification(notification, exclude?)`
  - `WebSocketExternalServer.sendNotification(userId, notification)`
  - `Broadcaster.*`（`MemoryBroadcaster` 经同一构造入口；见 §11）

> 兼容保留：`WebSocketExternalServer.broadcast(unknown)` / `sendTo(userId, unknown)` 仍对传入对象
> **原样编码透传**（形状由调用方决定）。它们不是规范化路径，不保证带 `kind`。
> 新代码应使用 `broadcastNotification` / `sendNotification` / `Broadcaster`。

---

## 6. 握手鉴权

`WebSocketExternalServerOptions.authenticate` 是唯一握手钩子（可选，未配置时行为与旧版一致）：

```ts
authenticate?(input: {
  headers: Record<string, string | string[] | undefined>;
  url: string;                // 含查询串
  protocol?: string;          // Sec-WebSocket-Protocol 首个值
}): Promise<{ userId: bigint } | null>;
```

- 在 WS upgrade 阶段调用。
- 返回 `null`（或 `userId === 0n`）→ 以 HTTP **401** 拒绝升级。
- 成功且 `userId !== 0n` → 连接建立时绑定 userId：
  - 每次 `execute` 的 `FlowContext` 预置该 userId；
  - 连接登记进连接注册表，可被定向推送（§11）。
- 凭据约定（由应用侧 `authenticate` 决定，框架只透传 `headers/url`）：
  - `Authorization: Bearer <token>`（Node 客户端可设置握手头）；
  - URL 查询参数 `?token=<token>`（浏览器 `WebSocket` 无法设置请求头时的通道）。

---

## 7. 心跳

- 服务端按 `heartbeatInterval`（默认 **30000ms**）对每个连接 `ws.ping()`。
- 连接收到 `pong` 则标记存活；连续未回 pong 的连接在下一周期被 `terminate()` 并清理注册表。
- ping/pong 走 WS 协议层，浏览器的 JS 观察不到任何事件；**客户端存活检测应使用应用层心跳**
  （周期建议 ≤ `heartbeatInterval` 之半，例如复用 system 段 ping Action）。

---

## 8. 错误语义

| errorCode | 含义 | 触发 |
|---|---|---|
| `undefined` / `0` | 成功 | 正常返回 |
| `400` | 消息无法解析 | 服务端解码失败（坏帧） |
| `404` | Action 未注册 | `(cmd, subCmd)` 无匹配路由 |
| `500` | 内部异常 | Action 抛错 / 业务错误 |

- 客户端应统一判定 `errorCode !== 0` 为失败。
- 错误响应同样遵守 §4：仅当请求带 `reqId` 时回显 `reqId` + `kind='response'`。

---

## 9. HTTP fallback 通道

`HttpExternalServer`（`HttpExternalServerOptions.pathPrefix`，默认 `/api`）：

- 路由：`POST /{prefix}/{cmd}/{subCmd}`（如 `POST /api/1/1`）。
- 请求体：经 codec 解码；**裸 DTO 与 `{ "data": {...} }` 包装两种都接受**。
- 响应：与 WS 同构的 `{data?, errorCode?, errorMessage?}`；
  HTTP 状态码 = `errorCode >= 400 ? errorCode : 200`。
- 失败语义：路径不合法 → 404；body 解析失败 → 400；未就绪 → 503。
- HTTP 通道当前**不产生** `reqId`/`kind`（响应由 `createResponseMessage(result)` 构造，无请求配对语义）。
- ⚠️ 部署注意：默认前缀 `/api` 会与 NestJS REST 的 `/api` 冲突，同机部署需分前缀（如 REST `/api`、ionet HTTP `/ionet`）。

### 9.1 配置独立前缀（NestJS）

`IonetModule` 的 `httpServer` 直接继承传输层 `HttpExternalServerOptions`，`pathPrefix` 经
`forRoot` 与 `forRootAsync` 两条链路透传（P2-2）。最小示例：

```typescript
IonetModule.forRoot({
  actions: [HallAction],
  httpServer: { enabled: true, port: 9090, pathPrefix: '/ionet' }, // 路由 POST /ionet/{cmd}/{subCmd}
  wsServer: false,
  redis: false,
});
```

- 省略 `pathPrefix` 时仍为 `/api`（既有行为不变）。
- 前缀可带或不带前导 `/`（`'/ionet'` 与 `'ionet'` 等价）。
- 与 WS 通道路由/信封同构；HTTP 仍不产生 `reqId`/`kind`（见本节首条）。

---

## 10. 服务端推送与连接注册表

- `WebSocketExternalServer.connectionRegistry` 暴露 core-framework 的 `ConnectionRegistry` 适配器：
  每个已绑定 userId 注册一个「扇出 Connection」，向其全部 OPEN 连接发送；无连接时自动注销。
- `IonetModule`（`@nbb-ionet/extension-nestjs`）默认提供并导出 `IONET_BROADCASTER`：
  数据源即上述注册表；`broadcaster: false` 可关闭。
- 经 `Broadcaster` / `broadcastNotification` / `sendNotification` 发出的推送一律带 `kind='notification'`。
- 定向推送语义：`sendTo/sendNotification` 向该 userId 的全部 OPEN 连接发送，至少命中一个返回 `true`；
  `userId === 0n` 或未绑定/无 OPEN 连接返回 `false`（不抛错）。

---

## 11. Codegen 产物与线协议

`extension-codegen` 产出的 Request / Response 与上述信封逐字段一致：

- Request：`{ cmd, subCmd, data }`
- Response：`{ data, errorCode?, errorMessage?, reqId?, kind? }`（**不再生成 `cmd/subCmd`**）

`reqId`/`kind` 为可选，仅新协议路径出现。生成物只作 API 层类型参考；
客户端 SDK 的线协议类型应以本文件为唯一真相。

---

## 12. 兼容性红线

1. 旧客户端（请求不带 `reqId`）的响应字节不变：不出现 `reqId` / `kind`。
2. 旧客户端（请求不带 `reqId`）的 errcode 语义不变（§8）。
3. 推送帧新增字段向后兼容：客户端按 `kind` 分流，未知字段忽略。
4. `broadcast(unknown)` / `sendTo(unknown)` 的裸透传行为保留；未启用 Broadcaster 时零额外行为变化。

---

## 13. 二进制编解码与机器可读 schema（P2-1）

`extension-jprotobuf` 的线格式是私有自描述的 `[1B typeName 长度][typeName][protobuf 载荷]`；
schema 的唯一真相是 `@ProtobufClass` / `@ProtobufField` 装饰器元数据。为让**非 TS 客户端**
也能实现可互操作的编解码，框架导出与装饰器元数据**同源**的机器可读 schema 清单。

### 13.1 取清单

```typescript
import { ProtobufProtocolCodec } from '@nbb-ionet/extension-jprotobuf';

const codec = new ProtobufProtocolCodec();
codec.registerType(User);
codec.registerType(Message);

// 对象清单（JSON 可序列化）
const schema = codec.toSchema();
// {
//   formatVersion: 1,
//   types: [
//     { name: 'Message', fields: [
//       { name: 'content', tag: 1, type: 'string' },
//       { name: 'sender',  tag: 2, type: 'message', messageType: 'User' },
//       { name: 'tags',    tag: 3, type: 'string', repeated: true },
//     ] },
//     { name: 'User', fields: [ /* ... */ ] },
//   ],
// }

// 或 proto3 文本（直接喂给 protoc / 其他语言工具链）
const proto = codec.toProto();
```

- 也可不持有 codec：纯函数 `buildSchema(constructors)` / `buildProto(constructors)`，
  传入一组带装饰器的类即可。
- `types[].name` 即线格式里的 typeName，也是解码注册键；`fields[]` 给出
  `{ name, tag, type, repeated?, messageType? }`。
- 输出按 typeName、tag 排序，逐字节稳定，可作为跨端契约快照纳入版本控制。
- 纯增量：不改变既有线格式与编解码行为。

### 13.2 非 TS 客户端如何用

1. 启动时取 `schema`（或 `proto`），据 `types[].name` 建立「typeName → 字段 tag/类型」注册表。
2. 解码前**必须先按相同 typeName 注册类型**；未注册时抛 `Type <name> not registered`
   （线格式不自带字段定义，只带 typeName）。
3. 按 protobuf wire format 读写载荷；`type: 'message'` 时按 `messageType` 递归解析，
   `repeated: true` 为重复字段，缺省 `type` 视为 `string`。
4. 编码时前缀写 `[1B typeName 长度][typeName UTF-8]` 再拼 protobuf 载荷。

---

## 14. 一致性套件对照表（A1）

> 规格 → 用例的逐条映射。**主套件**：`packages/external-server/src/protocol-conformance.test.ts`
> （22 个用例，每个用例名以「§N」开头标注所对照的条款号；`it()` 全名即「§N …」整串）。
> 运行方式：`pnpm --filter @nbb-ionet/external-server run test`；单条按名过滤：
> `pnpm --filter @nbb-ionet/external-server run test -t "<用例名片段>"`。
> 表中「既有」指套件之外、任务 1 之前已存在的专项用例（本套件不改动其任一行）。

| 条款 | 测试文件 | 用例 |
|---|---|---|
| §1 连接与路径 | `websocket-server.test.ts`（既有） | attach 模式共享 http.Server 请求/响应信封、非 `/ws` 路径 upgrade 400 拒绝、`stop()` 不关闭共享 server、独立模式监听 |
| §2 编解码 SPI | —（间接覆盖） | 默认 JSON codec 由 §3–§9 全部信封用例间接覆盖；二进制 codec 见 §13 |
| §3 请求信封 | `protocol-conformance.test.ts` | §3 请求信封 cmd/subCmd/data/headers/traceId 均透传到 FlowContext（inspect 回读）；§3+§4.1 携带 reqId 的全字段信封被接受；reqId 按配对语义在响应中原样回显 |
| §4 / §4.1 响应信封 | `protocol-conformance.test.ts` | §4+§12.1 旧协议（不带 reqId）：响应逐字节仅含 data/errorCode/errorMessage，不出现 reqId/kind；§4+§8+§12.2 旧协议错误响应（不带 reqId）：同样不注入 reqId/kind，errcode 语义不变；§4 新协议（带 reqId）：回显 reqId 且写入 kind="response"；不回显 cmd/subCmd |
| §5 推送信封 | `protocol-conformance.test.ts`；`websocket/notification-envelope.test.ts`（既有） | §5 broadcastNotification：产出帧带 kind="notification"，与 kind="response" 可判别；§5 sendNotification：定向推送帧带 kind="notification"；未命中返回 false 不抛错 |
| §6 握手鉴权 | `protocol-conformance.test.ts`；`websocket/handshake-auth.test.ts`（既有） | §6 无凭据 → upgrade 以 HTTP 401 被拒；§6 Authorization: Bearer <jwt> → 握手成功，FlowContext 预置 userId；§6 URL 查询参数 ?token=<jwt> → 握手成功，FlowContext 预置 userId |
| §7 心跳 | 暂无独立用例 | 心跳为 30s 周期行为（ws 层 ping/pong），当前套件不做计时断言 |
| §8 错误语义 | `protocol-conformance.test.ts` | §8 坏帧（非 JSON）→ errorCode=400；§8 未注册 Action → errorCode=404；§8 Action 内部抛错 → errorCode=500；§8+§4 带 reqId 的错误响应同样回显 reqId 与 kind="response"（404 路径） |
| §9 HTTP fallback | `protocol-conformance.test.ts`；`http-server.test.ts`（既有） | §9 POST /{prefix}/{cmd}/{subCmd} 命中（默认前缀 /api）；§9 裸 DTO 与 {data} 包装等价（标量/数组 DTO）；§9 object DTO 经 {data} 包装完整到达 Action；§9 状态码 = errorCode>=400 ? errorCode : 200（404/400/500 全覆盖）；§9 HTTP 响应不产生 reqId/kind（成功与 404 错误响应逐键断言）；既有：pathPrefix（§9.1）3 用例 |
| §10 连接注册表/定向推送 | `websocket/send-to.test.ts`、`websocket/connection-registry.test.ts`（既有） | 绑定/解绑/清理/多连接扇出/sendTo 未命中 false 等 9 用例 |
| §11 Broadcaster | `protocol-conformance.test.ts`；`websocket/connection-registry.test.ts`（既有） | §5+§11 MemoryBroadcaster.encode：Broadcaster 路径产出帧带 kind="notification"；既有：broadcastToUser 端到端信封 / 未绑定静默完成 / 多连接扇出 |
| §12 兼容性红线 | `protocol-conformance.test.ts` | §12.4 broadcast(unknown)：旧裸透传逐字节不变（不注入 kind）；§12.4 sendTo(unknown)：旧裸透传逐字节不变；§12.1/§12.2 由 §4 两条旧协议用例覆盖 |
| §13 二进制 schema | `extension-jprotobuf` · `protobuf-codec.test.ts`、`schema.test.ts`（既有） | P2-1 用例（不属于 external-server 套件） |

