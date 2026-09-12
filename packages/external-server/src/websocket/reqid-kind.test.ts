import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
  createNotificationMessage,
} from '@nbb-ionet/core-framework';
import { WebSocketExternalServer } from './ws-server.js';

const TEST_CMD = { cmd: 310, echo: 1 } as const;

@ActionController(TEST_CMD.cmd)
class EchoAction {
  @ActionMethod(TEST_CMD.echo)
  echo(data: unknown): unknown {
    return data;
  }
}

describe('WebSocketExternalServer reqId / kind（任务 2）', () => {
  let httpServer: Server;
  let server: WebSocketExternalServer;
  let port: number;

  beforeAll(async () => {
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;

    const skeleton = new BarSkeletonBuilder().addAction(EchoAction).build();
    server = new WebSocketExternalServer({ server: httpServer, path: '/ws' });
    await server.start(skeleton);
  });

  afterAll(async () => {
    await server.stop();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  });

  function connect(): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    return new Promise((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) {
        resolve(ws);
        return;
      }
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
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

  it('带 reqId：响应回显 reqId + kind=response，data 原样透传', async () => {
    const ws = await connect();
    const data = { a: 1, b: [2, 3], nested: { ok: true } };

    const res = await request(ws, {
      cmd: TEST_CMD.cmd,
      subCmd: TEST_CMD.echo,
      data,
      reqId: 'r-1',
    });

    expect(res.reqId).toBe('r-1');
    expect(res.kind).toBe('response');
    expect(res.data).toEqual(data);

    await closeWebSocket(ws);
  });

  it('number 型 reqId 同样回显', async () => {
    const ws = await connect();
    const res = await request(ws, {
      cmd: TEST_CMD.cmd,
      subCmd: TEST_CMD.echo,
      data: 'x',
      reqId: 42,
    });
    expect(res.reqId).toBe(42);
    expect(res.kind).toBe('response');
    await closeWebSocket(ws);
  });

  it('不带 reqId 的旧请求：响应逐字节不含 reqId / kind', async () => {
    const ws = await connect();
    const res = await request(ws, {
      cmd: TEST_CMD.cmd,
      subCmd: TEST_CMD.echo,
      data: 'legacy',
    });

    expect('reqId' in res).toBe(false);
    expect('kind' in res).toBe(false);
    expect(res).toEqual({ data: 'legacy' });

    await closeWebSocket(ws);
  });

  it('通知（kind=notification）与响应（kind=response）可区分', async () => {
    const ws = await connect();
    const pending = nextMessage(ws);

    server.broadcast(createNotificationMessage({ data: { event: 'tick' } }));

    const notification = await pending;
    expect(notification.kind).toBe('notification');
    expect(notification.data).toEqual({ event: 'tick' });

    const res = await request(ws, {
      cmd: TEST_CMD.cmd,
      subCmd: TEST_CMD.echo,
      data: 'after',
      reqId: 'r-2',
    });
    expect(res.kind).toBe('response');
    expect(notification.kind).not.toBe(res.kind);

    await closeWebSocket(ws);
  });

  it('错误响应同样回显 reqId / kind', async () => {
    const ws = await connect();
    const res = await request(ws, {
      cmd: 999,
      subCmd: 999,
      data: null,
      reqId: 'r-err',
    });
    expect(res.errorCode).toBe(404);
    expect(res.reqId).toBe('r-err');
    expect(res.kind).toBe('response');
    await closeWebSocket(ws);
  });
});
