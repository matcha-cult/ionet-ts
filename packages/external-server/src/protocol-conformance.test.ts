import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
  createMemoryBroadcaster,
  getCurrentFlowContext,
  type Connection,
  type ConnectionRegistry,
} from '@nbb-ionet/core-framework';
import { WebSocketExternalServer, type WebSocketAuthInput } from './websocket/ws-server.js';
import { HttpExternalServer } from './http/http-server.js';
// A3 任务 3：协议一致性金样单一真相 —— A1 套件与 @nbb-ionet/client-protocol 客户端
// 套件消费同一组 ENVELOPE_GOLDENS（经 ./testing 子路径），避免两份协议真相。
import { ENVELOPE_GOLDENS, type EnvelopeGolden } from '@nbb-ionet/client-protocol/testing';

function golden(id: string): EnvelopeGolden {
  const g = ENVELOPE_GOLDENS.find((item) => item.id === id);
  if (!g) {
    throw new Error('missing envelope golden: ' + id);
  }
  return g;
}

/**
 * A1 · 协议一致性套件（PROTOCOL.md 条款 ↔ 可执行断言）。
 *
 * 目的：把散落在 websocket/{reqid-kind,handshake-auth,notification-envelope,send-to,
 * connection-registry}.test.ts、http-server.test.ts、websocket-server.test.ts 中的协议行为，
 * 按 PROTOCOL.md 的条款号收敛为一份可独立运行、可对照规格的回归套件。
 *
 * 约定：
 * - 每个用例名以「§N」开头标注其断言的 PROTOCOL.md 条款（必要时组合多条）；
 * - 信封形状/字节断言与 @nbb-ionet/client-protocol 的协议一致性金样同源（A3 任务 3）：
 *   同一组 ENVELOPE_GOLDENS（经 './testing' 子路径），避免两份协议真相；
 * - 只增测试、不改运行时：既有 45 个用例零改动、保持全绿；
 * - WS 侧统一 attach 模式（共享 http.Server、端口随机），HTTP 侧用独立固定端口（见 §9 describe）。
 *
 * 条款映射总览（详见各 describe）：
 *   §3  请求信封（cmd/subCmd/data/headers/traceId 透传 FlowContext；reqId 见 §4.1）
 *   §4/§4.1/§12 响应信封（旧协议逐字节兼容 / 新协议回显 reqId + kind / 不回显 cmd/subCmd）
 *   §5/§11/§12.4 推送信封（broadcastNotification/sendNotification/Broadcaster vs 旧裸透传）
 *   §6  握手鉴权三态（无凭据 401 / Authorization Bearer / ?token= 查询参数）
 *   §8  错误语义（400 坏帧 / 404 未注册 / 500 内部抛错；带 reqId 时遵守 §4 回显）
 *   §9  HTTP fallback 通道（路径命中 / 裸 DTO 与 {data} 包装 / 状态码映射 / 不产生 reqId/kind）
 */

/** 单控制面 Action：cmd=410；subCmd：echo=1（透传 data）、inspect=2（回读 FlowContext）、boom=3（抛错）。 */
const CONFORMANCE_CMD = 410;
const SUB_ECHO = 1;
const SUB_INSPECT = 2;
const SUB_BOOM = 3;

@ActionController(CONFORMANCE_CMD)
class ConformanceAction {
  @ActionMethod(SUB_ECHO)
  echo(data: unknown): unknown {
    return data;
  }

  /** §3：回读 FlowContext 可见字段，供透传断言使用。 */
  @ActionMethod(SUB_INSPECT)
  inspect(): {
    userId: string;
    cmd: number;
    subCmd: number;
    headers?: Record<string, string>;
    traceId?: string;
    data?: unknown;
  } {
    const ctx = getCurrentFlowContext();
    const request = ctx?.getRequest();
    return {
      userId: ctx?.getUserId().toString() ?? '0',
      cmd: ctx?.getCmdInfo().cmd,
      subCmd: ctx?.getCmdInfo().subCmd,
      headers: request?.headers,
      traceId: request?.traceId,
      data: request?.data,
    };
  }

  /** §8：Action 内部抛错 → 500。 */
  @ActionMethod(SUB_BOOM)
  boom(): unknown {
    throw new Error('conformance-boom');
  }
}

/* ------------------------------------------------------------------ */
/* 测试骨架：WS attach rig / 连接与帧工具 / HTTP 客户端                   */
/* ------------------------------------------------------------------ */

interface WsRig {
  httpServer: Server;
  server: WebSocketExternalServer;
  port: number;
}

async function startWsRig(
  authenticate?: (input: WebSocketAuthInput) => Promise<{ userId: bigint } | null>,
): Promise<WsRig> {
  const httpServer = createServer();
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  const skeleton = new BarSkeletonBuilder().addAction(ConformanceAction).build();
  const server = new WebSocketExternalServer({ server: httpServer, path: '/ws', authenticate });
  await server.start(skeleton);
  return { httpServer, server, port };
}

async function stopWsRig(rig: WsRig): Promise<void> {
  await rig.server.stop();
  await new Promise<void>((resolve, reject) =>
    rig.httpServer.close((err) => (err ? reject(err) : resolve())),
  );
}

function wsUrl(port: number, query?: string): string {
  return 'ws://127.0.0.1:' + port + '/ws' + (query ? '?' + query : '');
}

function connect(
  port: number,
  options?: { headers?: Record<string, string>; query?: string },
): Promise<WebSocket> {
  const ws = new WebSocket(
    wsUrl(port, options?.query),
    options?.headers ? { headers: options.headers } : undefined,
  );
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve(ws);
      return;
    }
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** §6：期望握手被拒，返回 HTTP 状态码（以 unexpected-response 为准）。 */
function expectHandshakeRejected(
  port: number,
  options?: { headers?: Record<string, string>; query?: string },
): Promise<number> {
  const ws = new WebSocket(
    wsUrl(port, options?.query),
    options?.headers ? { headers: options.headers } : undefined,
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for rejection')), 3000);
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      resolve(res.statusCode ?? -1);
    });
    ws.on('error', () => {
      /* 401 拒绝后 ws 客户端还会派发 error；以 unexpected-response 为准 */
    });
    ws.on('open', () => {
      clearTimeout(timer);
      reject(new Error('handshake should have been rejected'));
    });
  });
}

/** 捕获下一条帧的原始字节文本（不解析），供「逐字节」类断言使用。 */
function nextRaw(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(data.toString()));
  });
}

function nextParsed(ws: WebSocket): Promise<any> {
  return nextRaw(ws).then((raw) => JSON.parse(raw));
}

async function sendRawRequest(ws: WebSocket, payload: unknown): Promise<string> {
  const pending = nextRaw(ws);
  ws.send(JSON.stringify(payload));
  return pending;
}

async function sendRequest(ws: WebSocket, payload: unknown): Promise<any> {
  return JSON.parse(await sendRawRequest(ws, payload));
}

function closeWebSocket(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.on('close', () => resolve());
    ws.close();
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* §3 请求信封 → FlowContext（WS）                                      */
/* ------------------------------------------------------------------ */

describe('协议一致性套件 · §3 请求信封 → FlowContext（WS）', () => {
  let rig: WsRig;

  beforeAll(async () => {
    rig = await startWsRig();
  });

  afterAll(async () => {
    await stopWsRig(rig);
  });

  it('§3 请求信封 cmd/subCmd/data/headers/traceId 均透传到 FlowContext（inspect 回读）', async () => {
    const ws = await connect(rig.port);
    const data = { n: 1, s: 'x' };

    const res = await sendRequest(ws, {
      cmd: CONFORMANCE_CMD,
      subCmd: SUB_INSPECT,
      data,
      headers: { 'x-trace': 'abc', authorization: 'Bearer x' },
      traceId: 'trace-9',
    });

    expect(res.data.cmd).toBe(CONFORMANCE_CMD);
    expect(res.data.subCmd).toBe(SUB_INSPECT);
    expect(res.data.data).toEqual(data);
    expect(res.data.headers).toEqual({ 'x-trace': 'abc', authorization: 'Bearer x' });
    expect(res.data.traceId).toBe('trace-9');

    await closeWebSocket(ws);
  });

  it('§3+§4.1 携带 reqId 的全字段信封被接受；reqId 按配对语义在响应中原样回显', async () => {
    // PROTOCOL.md §4.1：reqId 是「请求↔响应配对 id」，不进入 FlowContext，服务端在响应中原样回显。
    // 请求形状与字段取自共享金样 request-full（A3 任务 3：同源）。
    const request = golden('request-full').decoded;
    const ws = await connect(rig.port);

    const res = await sendRequest(ws, request as Record<string, unknown>);

    expect(res.reqId).toBe(golden('request-full').decoded.reqId);
    expect(res.data).toBe(golden('request-full').decoded.data);

    await closeWebSocket(ws);
  });
});

/* ------------------------------------------------------------------ */
/* §4 响应信封（WS）：旧协议逐字节 / 新协议回显 / 不回显 cmd/subCmd        */
/* ------------------------------------------------------------------ */

describe('协议一致性套件 · §4 响应信封（WS）', () => {
  let rig: WsRig;

  beforeAll(async () => {
    rig = await startWsRig();
  });

  afterAll(async () => {
    await stopWsRig(rig);
  });

  it('§4+§12.1 旧协议（不带 reqId）：响应逐字节仅含 data/errorCode/errorMessage，不出现 reqId/kind', async () => {
    const ws = await connect(rig.port);

    const raw = await sendRawRequest(ws, {
      cmd: CONFORMANCE_CMD,
      subCmd: SUB_ECHO,
      data: 'legacy',
    });

    // 字节真相取自共享金样（A3 任务 3）：response-legacy-success
    expect(raw).toBe(golden('response-legacy-success').wire);

    await closeWebSocket(ws);
  });

  it('§4+§8+§12.2 旧协议错误响应（不带 reqId）：同样不注入 reqId/kind，errcode 语义不变', async () => {
    const ws = await connect(rig.port);

    const res = await sendRequest(ws, { cmd: 999, subCmd: 999, data: null });
    const legacyError = golden('response-legacy-error').decoded;

    expect(res.errorCode).toBe(legacyError.errorCode);
    for (const absent of golden('response-legacy-error').absent ?? []) {
      expect(absent in res).toBe(false);
    }

    await closeWebSocket(ws);
  });

  it('§4 新协议（带 reqId）：回显 reqId 且写入 kind="response"；不回显 cmd/subCmd', async () => {
    const ws = await connect(rig.port);

    const res = await sendRequest(ws, {
      cmd: CONFORMANCE_CMD,
      subCmd: SUB_ECHO,
      data: { a: 1 },
      reqId: 'r-1',
    });

    // 形状真相取自共享金样（A3 任务 3）：response-new
    expect(res).toEqual(golden('response-new').decoded);
    for (const absent of golden('response-new').absent ?? []) {
      expect(absent in res).toBe(false);
    }

    await closeWebSocket(ws);
  });
});

/* ------------------------------------------------------------------ */
/* §5 推送信封 / §11 Broadcaster / §12.4 旧裸透传兼容                    */
/* ------------------------------------------------------------------ */

describe('协议一致性套件 · §5 推送信封 / §11 Broadcaster / §12.4 裸透传', () => {
  const PUSH_USER = 6102n;
  let rig: WsRig;

  beforeAll(async () => {
    rig = await startWsRig(async () => ({ userId: PUSH_USER }));
  });

  afterAll(async () => {
    await stopWsRig(rig);
  });

  it('§5 broadcastNotification：产出帧带 kind="notification"，与 kind="response" 可判别', async () => {
    const ws = await connect(rig.port);
    const pending = nextParsed(ws);

    rig.server.broadcastNotification({ cmd: 100, subCmd: 1, data: { hello: 'world' } });

    const frame = await pending;
    const expected = golden('notification-broadcast').decoded;
    expect(frame.kind).toBe(expected.kind);
    expect(frame.kind).not.toBe('response');
    expect(frame.cmd).toBe(expected.cmd);
    expect(frame.subCmd).toBe(expected.subCmd);
    expect(frame.data).toEqual(expected.data);
    // 时间戳由框架注入当前时刻：金样存具体值，这里只断言存在且为 number
    expect(typeof frame.timestamp).toBe('number');

    await closeWebSocket(ws);
  });

  it('§5 sendNotification：定向推送帧带 kind="notification"；未命中返回 false 不抛错', async () => {
    const ws = await connect(rig.port);
    await delay(60); // 等待握手绑定 userId 完成

    const pending = nextParsed(ws);
    const hit = rig.server.sendNotification(PUSH_USER, { cmd: 200, subCmd: 1, data: { n: 1 } });
    expect(hit).toBe(true);

    const frame = await pending;
    const expected = golden('notification-send').decoded;
    expect(frame.kind).toBe(expected.kind);
    expect(frame.cmd).toBe(expected.cmd);
    expect(frame.data).toEqual(expected.data);

    expect(rig.server.sendNotification(999999n, { cmd: 1, subCmd: 1 })).toBe(false);

    await closeWebSocket(ws);
  });

  it('§5+§11 MemoryBroadcaster.encode：Broadcaster 路径产出帧带 kind="notification"', async () => {
    // encode 为私有实现，此处经公开 API broadcastToUser 观测其线格式产出。
    const frames: string[] = [];
    const connection: Connection = {
      id: '6105',
      get ready() {
        return true;
      },
      send(data: string): void {
        frames.push(data);
      },
      close(): void {
        /* no-op */
      },
    };
    const registry: ConnectionRegistry = {
      register: () => {
        /* no-op */
      },
      unregister: () => {
        /* no-op */
      },
      getLocalUserIds: () => ['6105'],
      isLocalUser: () => false,
      getLocalConnection: () => connection,
    };
    const { broadcaster } = createMemoryBroadcaster({ connections: registry });

    await broadcaster.broadcastToUser('6105', {
      type: 'room.tick',
      data: { n: 1 },
      timestamp: 1700000000000,
      fromUserId: '42',
    });

    expect(frames).toHaveLength(1);
    const frame = JSON.parse(frames[0]);
    // 整帧形状取自共享金样（A3 任务 3）：notification-broadcaster
    expect(frame).toEqual(golden('notification-broadcaster').decoded);
  });

  it('§12.4 broadcast(unknown)：旧裸透传逐字节不变（不注入 kind）', async () => {
    const ws = await connect(rig.port);
    const pending = nextRaw(ws);

    rig.server.broadcast({ type: 'notification', message: 'legacy' });

    const raw = await pending;
    // 旧裸透传逐字节不变：字节真相取自共享金样（A3 任务 3）
    expect(raw).toBe(golden('passthrough-legacy-push').wire);

    await closeWebSocket(ws);
  });

  it('§12.4 sendTo(unknown)：旧裸透传逐字节不变', async () => {
    const ws = await connect(rig.port);
    await delay(60); // 等待握手绑定 userId 完成

    const pending = nextRaw(ws);
    const payload = golden('passthrough-sendto').decoded;
    const hit = rig.server.sendTo(PUSH_USER, payload as Record<string, unknown>);
    expect(hit).toBe(true);

    const raw = await pending;
    expect(raw).toBe(golden('passthrough-sendto').wire);

    await closeWebSocket(ws);
  });
});

/* ------------------------------------------------------------------ */
/* §6 握手鉴权三态（WS upgrade）                                        */
/* ------------------------------------------------------------------ */

describe('协议一致性套件 · §6 握手鉴权三态', () => {
  const TOKEN = 'jwt-conformance-1';
  let rig: WsRig;

  beforeAll(async () => {
    rig = await startWsRig(async (input: WebSocketAuthInput) => {
      const raw = input.headers['authorization'];
      const headerValue = Array.isArray(raw) ? raw[0] : raw;
      if (headerValue === 'Bearer ' + TOKEN) {
        return { userId: 6103n };
      }
      // 浏览器 WebSocket 无法设置请求头时的通道：?token=<jwt> 查询参数。
      const query = new URL(input.url, 'ws://127.0.0.1').searchParams.get('token');
      if (query === TOKEN) {
        return { userId: 6103n };
      }
      return null;
    });
  });

  afterAll(async () => {
    await stopWsRig(rig);
  });

  it('§6 无凭据 → upgrade 以 HTTP 401 被拒', async () => {
    const status = await expectHandshakeRejected(rig.port);
    expect(status).toBe(401);
  });

  it('§6 Authorization: Bearer <jwt> → 握手成功，FlowContext 预置 userId', async () => {
    const ws = await connect(rig.port, { headers: { authorization: 'Bearer ' + TOKEN } });

    const res = await sendRequest(ws, { cmd: CONFORMANCE_CMD, subCmd: SUB_INSPECT, data: null });
    expect(res.errorCode).toBeUndefined();
    expect(res.data.userId).toBe('6103');

    await closeWebSocket(ws);
  });

  it('§6 URL 查询参数 ?token=<jwt> → 握手成功，FlowContext 预置 userId', async () => {
    const ws = await connect(rig.port, { query: 'token=' + TOKEN });

    const res = await sendRequest(ws, { cmd: CONFORMANCE_CMD, subCmd: SUB_INSPECT, data: null });
    expect(res.errorCode).toBeUndefined();
    expect(res.data.userId).toBe('6103');

    await closeWebSocket(ws);
  });
});

/* ------------------------------------------------------------------ */
/* §8 错误语义（WS）                                                    */
/* ------------------------------------------------------------------ */

describe('协议一致性套件 · §8 错误语义（WS）', () => {
  let rig: WsRig;

  beforeAll(async () => {
    rig = await startWsRig();
  });

  afterAll(async () => {
    await stopWsRig(rig);
  });

  it('§8 坏帧（非 JSON）→ errorCode=400', async () => {
    const ws = await connect(rig.port);
    const pending = nextParsed(ws);

    ws.send('this is not json');

    const res = await pending;
    expect(res.errorCode).toBe(400);
    expect(res.errorMessage).toBe('Invalid message format');

    await closeWebSocket(ws);
  });

  it('§8 未注册 Action → errorCode=404', async () => {
    const ws = await connect(rig.port);

    const res = await sendRequest(ws, { cmd: 999, subCmd: 999, data: null });

    expect(res.errorCode).toBe(404);
    expect(typeof res.errorMessage).toBe('string');

    await closeWebSocket(ws);
  });

  it('§8 Action 内部抛错 → errorCode=500', async () => {
    const ws = await connect(rig.port);

    const res = await sendRequest(ws, { cmd: CONFORMANCE_CMD, subCmd: SUB_BOOM, data: null });

    expect(res.errorCode).toBe(500);

    await closeWebSocket(ws);
  });

  it('§8+§4 带 reqId 的错误响应同样回显 reqId 与 kind="response"（404 路径）', async () => {
    const ws = await connect(rig.port);

    const res = await sendRequest(ws, { cmd: 999, subCmd: 999, data: null, reqId: 'r-404' });
    const expected = golden('response-new-error').decoded;

    expect(res.errorCode).toBe(expected.errorCode);
    expect(res.reqId).toBe(expected.reqId);
    expect(res.kind).toBe(expected.kind);

    await closeWebSocket(ws);
  });
});

/* ------------------------------------------------------------------ */
/* §9 HTTP fallback 通道                                               */
/* ------------------------------------------------------------------ */

describe('协议一致性套件 · §9 HTTP fallback 通道', () => {
  // HttpExternalServer.start 不暴露实际监听端口（port getter 回读构造项），
  // 沿用既有 http-server.test.ts 的固定端口约定（18080/18083/18084 之外）。
  const HTTP_PORT = 18085;
  let httpServer: HttpExternalServer;

  beforeAll(async () => {
    const skeleton = new BarSkeletonBuilder().addAction(ConformanceAction).build();
    httpServer = new HttpExternalServer({ port: HTTP_PORT });
    await httpServer.start(skeleton);
  });

  afterAll(async () => {
    await httpServer.stop();
  });

  function post(path: string, body?: string): Promise<Response> {
    return fetch('http://127.0.0.1:' + HTTP_PORT + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }

  it('§9 POST /{prefix}/{cmd}/{subCmd} 命中（默认前缀 /api）', async () => {
    const res = await post('/api/' + CONFORMANCE_CMD + '/' + SUB_ECHO, JSON.stringify('Hello'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: 'Hello' });
  });

  it('§9 裸 DTO 与 {data} 包装等价（标量 / 数组 DTO）', async () => {
    const echoPath = '/api/' + CONFORMANCE_CMD + '/' + SUB_ECHO;
    const bareScalar = await post(echoPath, JSON.stringify('Hello'));
    const wrappedScalar = await post(echoPath, JSON.stringify({ data: 'Hello' }));

    expect(await bareScalar.json()).toEqual(await wrappedScalar.json());

    const bareArray = await post(echoPath, JSON.stringify([1, 2]));
    const wrappedArray = await post(echoPath, JSON.stringify({ data: [1, 2] }));

    expect(await bareArray.json()).toEqual({ data: [1, 2] });
    expect(await wrappedArray.json()).toEqual({ data: [1, 2] });
  });

  it('§9 object DTO 经 {data} 包装完整到达 Action', async () => {
    const res = await post(
      '/api/' + CONFORMANCE_CMD + '/' + SUB_ECHO,
      JSON.stringify({ data: { msg: 'hi' } }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { msg: 'hi' } });
  });

  it('§9 状态码 = errorCode>=400 ? errorCode : 200（404/400/500 全覆盖）', async () => {
    const unknown = await post('/api/999/999', JSON.stringify(null));
    expect(unknown.status).toBe(404);
    const unknownBody = await unknown.json();
    expect(unknownBody.errorCode).toBe(404);

    const badBody = await post('/api/' + CONFORMANCE_CMD + '/' + SUB_ECHO, 'invalid json');
    expect(badBody.status).toBe(400);

    const thrown = await post('/api/' + CONFORMANCE_CMD + '/' + SUB_BOOM, JSON.stringify(null));
    expect(thrown.status).toBe(500);
    const thrownBody = await thrown.json();
    expect(thrownBody.errorCode).toBe(500);
  });

  it('§9 HTTP 响应不产生 reqId/kind（成功与 404 错误响应逐键断言）', async () => {
    const ok = await post('/api/' + CONFORMANCE_CMD + '/' + SUB_ECHO, JSON.stringify('Hello'));
    const okBody = await ok.json();
    expect(okBody).toEqual({ data: 'Hello' });
    for (const absent of golden('response-legacy-success').absent ?? []) {
      expect(absent in okBody).toBe(false);
    }

    const notFound = await post('/api/999/999', JSON.stringify(null));
    const notFoundBody = await notFound.json();
    expect(notFoundBody.errorCode).toBe(404);
    for (const absent of golden('response-legacy-error').absent ?? []) {
      expect(absent in notFoundBody).toBe(false);
    }
  });
});
