import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
  type ResponseKind,
} from '@nbb-ionet/core-framework';
import { WebSocketExternalServer } from './ws-server.js';

const TEST_CMD = { cmd: 331, echo: 1 } as const;
const USER_PUSH = 7101n;

@ActionController(TEST_CMD.cmd)
class EchoAction {
  @ActionMethod(TEST_CMD.echo)
  echo(data: unknown): unknown {
    return data;
  }
}

/**
 * 任务 2 / P1-3：推送信封规范化。
 * broadcastNotification / sendNotification 由框架构造 kind='notification' 信封；
 * 旧 broadcast(unknown) / sendTo(unknown) 的裸透传行为保留（向后兼容）。
 */
describe('推送信封规范化（任务 2 / P1-3）', () => {
  let httpServer: Server;
  let server: WebSocketExternalServer;
  let port: number;

  beforeAll(async () => {
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;

    const skeleton = new BarSkeletonBuilder().addAction(EchoAction).build();
    server = new WebSocketExternalServer({
      server: httpServer,
      path: '/ws',
      authenticate: async () => ({ userId: USER_PUSH }),
    });
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

  it('broadcastNotification：框架构造 kind=notification + timestamp，业务不得自造形状', async () => {
    const ws = await connect();
    const pending = nextMessage(ws);

    server.broadcastNotification({ cmd: 100, subCmd: 1, data: { hello: 'world' } });

    const frame = await pending;
    expect(frame.kind).toBe('notification');
    expect(frame.cmd).toBe(100);
    expect(frame.subCmd).toBe(1);
    expect(frame.data).toEqual({ hello: 'world' });
    expect(typeof frame.timestamp).toBe('number');

    await closeWebSocket(ws);
  });

  it('sendNotification：命中在线 userId 返回 true 且带 kind；未命中返回 false 不抛错', async () => {
    const ws = await connect();
    // 握手鉴权即绑定 USER_PUSH
    await new Promise((r) => setTimeout(r, 60));

    const pending = nextMessage(ws);
    const hit = server.sendNotification(USER_PUSH, { cmd: 200, subCmd: 1, data: { n: 1 } });
    expect(hit).toBe(true);
    const frame = await pending;
    expect(frame.kind).toBe('notification');
    expect(frame.cmd).toBe(200);

    expect(server.sendNotification(999999n, { cmd: 1, subCmd: 1 })).toBe(false);

    await closeWebSocket(ws);
  });

  it('kind 取值域与响应侧统一为 response | notification', () => {
    const notificationKind: ResponseKind = 'notification';
    const responseKind: ResponseKind = 'response';
    expect(notificationKind).not.toBe(responseKind);
    expect(['response', 'notification']).toContain(notificationKind);
    expect(['response', 'notification']).toContain(responseKind);
  });

  it('旧 broadcast(unknown) 裸透传行为保留（无 kind）', async () => {
    const ws = await connect();
    const pending = nextMessage(ws);

    server.broadcast({ type: 'notification', message: 'legacy' });

    const frame = await pending;
    expect(frame).toEqual({ type: 'notification', message: 'legacy' });
    expect('kind' in frame).toBe(false);

    await closeWebSocket(ws);
  });

  it('旧 sendTo(unknown) 裸透传行为保留（verify:sendto 依赖）', async () => {
    const ws = await connect();
    await new Promise((r) => setTimeout(r, 60));

    const pending = nextMessage(ws);
    const hit = server.sendTo(USER_PUSH, { kind: 'notification', cmd: 300, subCmd: 1, data: {} });
    expect(hit).toBe(true);
    const frame = await pending;
    expect(frame).toEqual({ kind: 'notification', cmd: 300, subCmd: 1, data: {} });

    await closeWebSocket(ws);
  });
});
