/**
 * A3（任务 3）· 协议一致性金样 —— PROTOCOL.md 条款 ↔ 可执行断言（单一真相）。
 *
 * 两个套件从同一组数据读取断言，避免两份协议真相：
 * - 本包客户端一致性套件（src/conformance/envelope-goldens.test.ts）：断言
 *   EnvelopeCodec encode/decode 与每个金样的字节/形状一致；
 * - A1 主套件（packages/external-server/src/protocol-conformance.test.ts）：同一组
 *   金样经 `@nbb-ionet/client-protocol/testing` 导入，断言服务端产出的线帧一致。
 *
 * 约定：
 * - wire 键序 = createRequestMessage / createResponseMessage / createNotificationMessage
 *   的构造键序（req: cmd→subCmd→data→headers→traceId→reqId；
 *   resp: data→errorCode→errorMessage→headers→reqId→kind；
 *   push: kind→type→cmd→subCmd→data→timestamp→headers→reqId→fromUserId）；
 * - 每个金样自洽：JSON.stringify(decoded) === wire（套件消费前自检）；
 * - absent 列出「解码后不得出现的键」（旧协议逐字节兼容 §12.1/§12.2 断言）。
 * 纯数据 + 纯函数，零导入（浏览器包内随 `./testing` 子路径分发）。
 */

export interface EnvelopeGolden {
  /** 稳定 id（供套件按名引用）。 */
  id: string;
  /** PROTOCOL.md 条款号（可与 A1 用例名组合对照 §14）。 */
  clause: string;
  /** 用例标题（与 A1 套件用例名对齐，便于 §14 映射）。 */
  title: string;
  /** 期望的线格式 JSON 字节（两个套件共同的字节真相）。 */
  wire: string;
  /** 解码后形状（含未知字段透传时保留的字段）。 */
  decoded: Record<string, unknown>;
  /** 解码后不得出现的键（§12.1/§12.2 旧协议兼容断言）。 */
  absent?: string[];
}

export const ENVELOPE_GOLDENS: EnvelopeGolden[] = [
  {
    id: 'request-full',
    clause: '§3+§4.1',
    title: '携带 reqId 的全字段请求信封被接受；reqId 按配对语义在响应中原样回显',
    wire:
      '{"cmd":410,"subCmd":1,"data":"full","headers":{"h":"1"},"traceId":"t-1","reqId":"r-full"}',
    decoded: {
      cmd: 410,
      subCmd: 1,
      data: 'full',
      headers: { h: '1' },
      traceId: 't-1',
      reqId: 'r-full',
    },
  },
  {
    id: 'response-legacy-success',
    clause: '§4+§12.1',
    title: '旧协议（不带 reqId）成功响应：逐字节仅含 data，不出现 reqId/kind',
    wire: '{"data":"legacy"}',
    decoded: { data: 'legacy' },
    absent: ['reqId', 'kind'],
  },
  {
    id: 'response-legacy-error',
    clause: '§4+§8+§12.2',
    title: '旧协议错误响应（不带 reqId）：同样不注入 reqId/kind，errcode 语义不变',
    wire: '{"errorCode":404}',
    decoded: { errorCode: 404 },
    absent: ['reqId', 'kind'],
  },
  {
    id: 'response-new',
    clause: '§4',
    title: '新协议（带 reqId）：回显 reqId 且写入 kind="response"；不回显 cmd/subCmd',
    wire: '{"data":{"a":1},"reqId":"r-1","kind":"response"}',
    decoded: { data: { a: 1 }, reqId: 'r-1', kind: 'response' },
    absent: ['cmd', 'subCmd'],
  },
  {
    id: 'response-new-error',
    clause: '§8+§4',
    title: '带 reqId 的错误响应同样回显 reqId 与 kind="response"',
    wire: '{"errorCode":404,"reqId":"r-404","kind":"response"}',
    decoded: { errorCode: 404, reqId: 'r-404', kind: 'response' },
  },
  {
    id: 'notification-broadcast',
    clause: '§5',
    title: 'broadcastNotification 帧带 kind="notification"，含 cmd/subCmd/data/timestamp',
    wire:
      '{"kind":"notification","cmd":100,"subCmd":1,"data":{"hello":"world"},"timestamp":1700000000000}',
    decoded: {
      kind: 'notification',
      cmd: 100,
      subCmd: 1,
      data: { hello: 'world' },
      timestamp: 1700000000000,
    },
  },
  {
    id: 'notification-send',
    clause: '§5',
    title: 'sendNotification 定向推送帧带 kind="notification"',
    wire: '{"kind":"notification","cmd":200,"subCmd":1,"data":{"n":1}}',
    decoded: { kind: 'notification', cmd: 200, subCmd: 1, data: { n: 1 } },
  },
  {
    id: 'notification-broadcaster',
    clause: '§5+§11',
    title: 'Broadcaster 路径帧带 kind="notification"，保留 type/data/timestamp/fromUserId',
    wire:
      '{"kind":"notification","type":"room.tick","data":{"n":1},"timestamp":1700000000000,"fromUserId":"42"}',
    decoded: {
      kind: 'notification',
      type: 'room.tick',
      data: { n: 1 },
      timestamp: 1700000000000,
      fromUserId: '42',
    },
  },
  {
    id: 'passthrough-legacy-push',
    clause: '§12.4',
    title: 'broadcast(unknown) 旧裸透传逐字节不变（不注入 kind）',
    wire: '{"type":"notification","message":"legacy"}',
    decoded: { type: 'notification', message: 'legacy' },
  },
  {
    id: 'passthrough-sendto',
    clause: '§12.4',
    title: 'sendTo(unknown) 旧裸透传逐字节不变（不注入/不裁剪字段）',
    wire: '{"kind":"notification","cmd":300,"subCmd":1,"data":{}}',
    decoded: { kind: 'notification', cmd: 300, subCmd: 1, data: {} },
  },
  {
    id: 'passthrough-future',
    clause: '§12.3',
    title: '推送帧新增字段向后兼容：未知字段 decode→encode 不丢、客户端按 kind 分流',
    wire: '{"kind":"notification","type":"x","data":{},"future":{"a":1}}',
    decoded: { kind: 'notification', type: 'x', data: {}, future: { a: 1 } },
  },
];

/** 按 id 取金样（缺失即抛错，保证两套件引用一致）。 */
export function goldenById(id: string): EnvelopeGolden {
  const golden = ENVELOPE_GOLDENS.find((g) => g.id === id);
  if (!golden) {
    throw new Error('missing envelope golden: ' + id);
  }
  return golden;
}
