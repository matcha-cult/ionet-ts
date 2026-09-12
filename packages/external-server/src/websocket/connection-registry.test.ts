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
  type Broadcaster,
} from '@nbb-ionet/core-framework';
import { WebSocketExternalServer } from './ws-server.js';

const TEST_CMD = { cmd: 330, echo: 1 } as const;

@ActionController(TEST_CMD.cmd)
class EchoAction {
  @ActionMethod(TEST_CMD.echo)
  echo(data: unknown): unknown {
    return data;
  }
}

const USER_A = 7001n;
const USER_B = 7002n;

/**
 * 任务 1 / P0-5：连接注册表适配器 → Broadcaster 端到端接线。
 * 握手时把 userId 绑定到 ws 连接，适配器将其映射进 core-framework 的
 * ConnectionRegistry；MemoryBroadcaster 复用同一注册表完成定向/扇出推送。
 */
describe('WebSocketExternalServer 连接注册表适配器 → Broadcaster（任务 1）', () => {
  let httpServer: Server;
  let server: WebSocketExternalServer;
  let broadcaster: Broadcaster;
  let port: number;

  beforeAll(async () => {
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;

    const skeleton = new BarSkeletonBuilder().addAction(EchoAction).build();
    server = new WebSocketExternalServer({
      server: httpServer,
      path: '/ws',
      authenticate: async ({ headers }) => {
        const raw = headers['x-user'];
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (!value) return null;
        return { userId: BigInt(value) };
      },
    });
    await server.start(skeleton);
    broadcaster = createMemoryBroadcaster({ connections: server.connectionRegistry }).broadcaster;
  });

  afterAll(async () => {
    await server.stop();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  });

  function connect(user: string): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { 'x-user': user } });
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

  async function waitFor(predicate: () => boolean, ms = 2000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((r) => setTimeout(r, 15));
    }
    return predicate();
  }

  it('未握手绑定时注册表为空', () => {
    expect(server.connectionRegistry.getLocalUserIds()).toEqual([]);
  });

  it('握手绑定后注册表出现在线 userId', async () => {
    const ws = await connect(String(USER_A));
    const listed = await waitFor(() => server.connectionRegistry.isLocalUser(String(USER_A)));
    expect(listed).toBe(true);
    expect(server.connectionRegistry.getLocalConnection(String(USER_A))?.id).toBe(String(USER_A));
    await closeWebSocket(ws);
  });

  it('broadcastToUser 命中：客户端收到 kind=notification 信封', async () => {
    const ws = await connect(String(USER_A));
    await waitFor(() => server.connectionRegistry.isLocalUser(String(USER_A)));

    const push = nextMessage(ws);
    await broadcaster.broadcastToUser(String(USER_A), {
      type: 'private',
      data: { hello: 'you' },
      timestamp: 1700000000000,
    });
    const frame = await push;
    expect(frame.kind).toBe('notification');
    expect(frame.type).toBe('private');
    expect(frame.data).toEqual({ hello: 'you' });
    expect(frame.timestamp).toBe(1700000000000);

    await closeWebSocket(ws);
  });

  it('未绑定 userId：broadcastToUser 静默完成（不抛错）', async () => {
    await expect(
      broadcaster.broadcastToUser('999999', { type: 'x', data: null, timestamp: Date.now() }),
    ).resolves.toBeUndefined();
  });

  it('同一 userId 多连接：扇出全部命中', async () => {
    const ws1 = await connect(String(USER_B));
    const ws2 = await connect(String(USER_B));
    await waitFor(() => server.connectionRegistry.isLocalUser(String(USER_B)) && server.clientCount >= 2);

    const p1 = nextMessage(ws1);
    const p2 = nextMessage(ws2);
    await broadcaster.broadcastToUser(String(USER_B), {
      type: 'fanout',
      data: { n: 2 },
      timestamp: Date.now(),
    });
    const [f1, f2] = await Promise.all([p1, p2]);
    expect(f1.kind).toBe('notification');
    expect(f2.kind).toBe('notification');
    expect(f1.data).toEqual({ n: 2 });

    await Promise.all([closeWebSocket(ws1), closeWebSocket(ws2)]);
  });

  it('连接关闭后注册表清理', async () => {
    const ws = await connect(String(USER_A));
    await waitFor(() => server.connectionRegistry.isLocalUser(String(USER_A)));

    await closeWebSocket(ws);
    const cleared = await waitFor(() => !server.connectionRegistry.isLocalUser(String(USER_A)));
    expect(cleared).toBe(true);
    expect(server.connectionRegistry.getLocalConnection(String(USER_A))).toBeUndefined();
  });
});
