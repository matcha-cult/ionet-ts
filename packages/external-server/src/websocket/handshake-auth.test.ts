import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
  getCurrentFlowContext,
} from '@nbb-ionet/core-framework';
import {
  WebSocketExternalServer,
  type WebSocketExternalServerOptions,
  type WebSocketAuthInput,
} from './ws-server.js';

const CMD = { cmd: 320, inspect: 1 } as const;

@ActionController(CMD.cmd)
class InspectAction {
  @ActionMethod(CMD.inspect)
  inspect(): { userId: string; headers?: Record<string, string>; traceId?: string } {
    const ctx = getCurrentFlowContext();
    const request = ctx?.getRequest();
    return {
      userId: ctx?.getUserId().toString() ?? '0',
      headers: request?.headers,
      traceId: request?.traceId,
    };
  }
}

interface Rig {
  httpServer: Server;
  server: WebSocketExternalServer;
  port: number;
}

async function startRig(
  authenticate?: WebSocketExternalServerOptions['authenticate'],
): Promise<Rig> {
  const httpServer = createServer();
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  const skeleton = new BarSkeletonBuilder().addAction(InspectAction).build();
  const server = new WebSocketExternalServer({ server: httpServer, path: '/ws', authenticate });
  await server.start(skeleton);
  return { httpServer, server, port };
}

async function stopRig(rig: Rig): Promise<void> {
  await rig.server.stop();
  await new Promise<void>((resolve, reject) =>
    rig.httpServer.close((err) => (err ? reject(err) : resolve())),
  );
}

function connect(port: number, headers?: Record<string, string>): Promise<WebSocket> {
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/ws`,
    headers ? { headers } : undefined,
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

function expectRejected(port: number, headers?: Record<string, string>): Promise<number> {
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/ws`,
    headers ? { headers } : undefined,
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for rejection')), 3000);
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      resolve(res.statusCode ?? -1);
    });
    ws.on('error', () => {
      /* 401 后 ws 客户端还会派发 error；以 unexpected-response 为准 */
    });
    ws.on('open', () => {
      clearTimeout(timer);
      reject(new Error('handshake should have been rejected'));
    });
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
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

async function request(ws: WebSocket, payload: unknown): Promise<any> {
  const pending = nextMessage(ws);
  ws.send(JSON.stringify(payload));
  return pending;
}

describe('headers / traceId 透传（任务 3）', () => {
  let rig: Rig;

  beforeAll(async () => {
    rig = await startRig();
  });

  afterAll(async () => {
    await stopRig(rig);
  });

  it('请求 headers / traceId 可在 Action 内经 ctx.getRequest() 读取', async () => {
    const ws = await connect(rig.port);
    const res = await request(ws, {
      cmd: CMD.cmd,
      subCmd: CMD.inspect,
      data: null,
      headers: { 'x-trace': 'abc', authorization: 'Bearer x' },
      traceId: 'trace-1',
    });

    expect(res.data.headers).toEqual({ 'x-trace': 'abc', authorization: 'Bearer x' });
    expect(res.data.traceId).toBe('trace-1');
    expect(res.data.userId).toBe('0');

    await closeWebSocket(ws);
  });

  it('未配置 authenticate：握手直接成功，userId 仍为 0（旧行为不变）', async () => {
    const ws = await connect(rig.port);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    const res = await request(ws, { cmd: CMD.cmd, subCmd: CMD.inspect, data: null });
    expect(res.errorCode).toBeUndefined();
    expect(res.data.userId).toBe('0');

    await closeWebSocket(ws);
  });
});

describe('握手鉴权 authenticate（任务 3）', () => {
  let rig: Rig;

  const authenticate = async (
    input: WebSocketAuthInput,
  ): Promise<{ userId: bigint } | null> => {
    const raw = input.headers['authorization'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === 'Bearer good') {
      return { userId: 123n };
    }
    return null;
  };

  beforeAll(async () => {
    rig = await startRig(authenticate);
  });

  afterAll(async () => {
    await stopRig(rig);
  });

  it('鉴权成功：Action 内 ctx.getUserId() 非 0，且注册表可 sendTo', async () => {
    const ws = await connect(rig.port, { authorization: 'Bearer good' });

    const res = await request(ws, { cmd: CMD.cmd, subCmd: CMD.inspect, data: null });
    expect(res.data.userId).toBe('123');

    const pushed = nextMessage(ws);
    expect(rig.server.sendTo(123n, { kind: 'notification', data: { hi: true } })).toBe(true);
    expect(await pushed).toEqual({ kind: 'notification', data: { hi: true } });

    await closeWebSocket(ws);
  });

  it('鉴权失败：upgrade 以 HTTP 401 被拒', async () => {
    const status = await expectRejected(rig.port, { authorization: 'Bearer bad' });
    expect(status).toBe(401);
  });

  it('缺少鉴权头：同样 401', async () => {
    const status = await expectRejected(rig.port);
    expect(status).toBe(401);
  });
});
