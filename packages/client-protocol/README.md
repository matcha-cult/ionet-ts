# @nbb-ionet/client-protocol

ionet 线协议的**浏览器安全**落地包（前端 SDK 的框架侧地基，A3 协作任务）。

- 作用面：**协议级内容**（信封形状 / 编解码 / 请求关联 / kind 分流），不含任何业务 cmd 段。
- 唯一规格：仓库根 `PROTOCOL.md`（§3 请求信封 / §4+§4.1 响应信封与 reqId 关联 / §5 推送信封与 kind
  分流 / §8 错误语义 / §12 兼容红线）。本包字段与框架侧 `core-framework/src/protocol/message.ts`
  逐字段一致，但不 import core-framework。
- **零 Node 依赖、零 npm 运行时依赖**：源码与产物仅使用 Web 标准 API（JSON、对象操作）；
  构建产物为纯 ESM（`platform: 'browser'`），可直接被浏览器 `<script type="module">` / bundler 消费。
  验收红线：仓内 `grep` 该内置前缀（含测试文件）在 src 与 dist **零命中**（本仓库文档刻意避免该字面量）。

## 安装

```bash
pnpm add @nbb-ionet/client-protocol
```

`@nbb-ionet/client-protocol/testing` 子路径提供与 A1 协议一致性套件共享的金样（见「与 A1 同源」）。

## 导出

| 导出 | 说明 | PROTOCOL 条款 |
|---|---|---|
| `RequestMessage` | 请求信封（cmd/subCmd 必填；data/headers/traceId/reqId 可选） | §3 |
| `ResponseMessage` | 响应信封（data/errorCode?/errorMessage?/reqId?/kind?） | §4 |
| `NotificationMessage` | 推送信封（kind 恒 'notification'） | §5 |
| `EnvelopeCodec` | JSON 编解码 + 未知字段透传（前向兼容） | §1/§12.3 |
| `classifyFrame` | 帧判别：request / response / notification / unknown | §5 |
| `RequestResponseAssociator` | reqId 精确配对 + 最早在途回退（旧服务） | §4.1 |
| `createNotificationMessage` | 唯一的推送信封构造出口（框架同构） | §5 / §2.2.4 |
| `isSuccess` | `errorCode !== 0` 判定失败 | §8 |

## 用法

```ts
import {
  EnvelopeCodec,
  classifyFrame,
  RequestResponseAssociator,
  createRequestMessage,
  createResponseMessage,
  createNotificationMessage,
  isSuccess,
} from '@nbb-ionet/client-protocol';

const codec = new EnvelopeCodec();

// ① 请求：唯一 reqId 入帧（新协议；服务端响应原样回显）
const request = createRequestMessage({ cmd: 30, subCmd: 1, data: { n: 1 }, reqId: 'r-1' });
ws.send(codec.encode(request));

// ② 收帧：先分流，再按需配对
const { kind, frame } = codec.decodeClassified(text);
if (kind === 'notification') {
  // 推送：kind==='notification'（§5）
} else if (kind === 'response') {
  const assoc = new RequestResponseAssociator();
  assoc.begin({ reqId: 'r-1' });
  const hit = assoc.associate(frame); // { ok, pending, by: 'reqId' | 'fifo' }
  if (hit.ok && isSuccess(frame)) { /* 按 hit.pending.seq 回填业务 */ }
}
```

### 关联策略（§4.1）

- 帧带 `reqId` → 与在途请求**精确配对**（并发未决、乱序返回可一一对应）；
- 帧不带 `reqId`（**旧服务**不回显）→ 回退到**最早在途请求**（FIFO）；
- 帧带 `reqId` 但无匹配 → 返回 `no-reqid-match`，绝不回退 FIFO（避免错配）；
- 旧客户端（不带 reqId 的请求）→ 按 begin 次序 FIFO，语义不变。

### 推送构造出口（§2.2.4）

业务不得自造推送形状：构造推送一律 `createNotificationMessage(...)`，`kind` 恒为
`'notification'`，与框架 `broadcastNotification / sendNotification / Broadcaster` 产出同构；
仅显式给出的可选字段才写入（字段集可裁剪，旧客户端逐字节兼容）。

## 构建与测试

```bash
pnpm --filter @nbb-ionet/client-protocol run build   # tsup platform:browser → dist（纯 ESM + DTS）
pnpm --filter @nbb-ionet/client-protocol run test    # 单元 + 浏览器安全断言（dist 断言需先 build）
pnpm -w run build                                    # 全仓构建（tsup 拓扑序）
```

## 与 A1 同源（任务 3）

客户端协议一致性断言与 A1 主套件**同一组**（避免两份协议真相）：

- 金样单一真相：`@nbb-ionet/client-protocol/testing` 导出 `ENVELOPE_GOLDENS`
  （11 个用例：§3/§4/§4.1/§5/§8/§11/§12.1–§12.4 的信封字节与形状，含键序、absent 键、未知字段透传）；
- 本包套件 `src/conformance/envelope-goldens.test.ts` 断言 `EnvelopeCodec` 与金样字节一致；
- A1 主套件 `packages/external-server/src/protocol-conformance.test.ts` 经
  `@nbb-ionet/client-protocol/testing` 导入同一组金样，断言服务端产出帧一致
  （external-server 仅作为 devDependency 在测试期引用，不进任何运行时依赖图）。

修改信封形状/键序/absent 约束时只需改 `src/conformance/envelope-goldens.ts` 一处，
两套套件同步生效（金样自洽断言 `JSON.stringify(decoded) === wire` 先行兜底）。