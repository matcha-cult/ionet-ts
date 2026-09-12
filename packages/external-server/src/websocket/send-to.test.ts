import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
  type ActionMethodInOut,
  type FlowContext,
} from '@nbb-ionet/core-framework';
import { WebSocketExternalServer } from './ws-server.js';

const TEST_CMD = { cmd: 300, bind: 1 } as const;

@ActionController(TEST_CMD.cmd)
class BindAction {
  @ActionMethod(TEST_CMD.bind)
  bind(data: string): string {
    return `bound:${data}`;
  }
}

/**
 * 模拟消费方 WsAuthInOut：从请求 data 取出 userId 并绑定。
 * 用 InOut 而非 (ctx, data) 形参，因为 vitest/esbuild 默认不产出 design:paramtypes，
 * FlowContext 形参在测试运行环境无法被 DefaultActionCommandParser 识别。
 */
class BindInOut implements ActionMethodInOut {
  fuckIn(ctx: FlowContext): void {
    const raw = ctx.getRequest()?.data;
    if (raw === undefined || raw === null) return;
    const userId = BigInt(String(raw));
    if (userId !== 0n) {
      ctx.bindingUserId(userId);
    }
  }

  fuckOut(): void {
    /* no-op */
  }
}

describe('WebSocketExternalServer sendTo 连接注册表（任务 1）', () => {
  let httpServer: Server;
  let server: WebSocketExternalServer;
  let port: number;

  beforeAll(async () => {
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;

    const skeleton = new BarSkeletonBuilder()
      .addAction(BindAction)
      .addInOut(new BindInOut())
      .build();
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

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** 发送绑定请求并等待其响应，确保 execute 完成、onBound 已登记到注册表。 */
  async function bindUser(ws: WebSocket, userId: string): Promise<void> {
    const ack = nextMessage(ws);
    ws.send(JSON.stringify({ cmd: TEST_CMD.cmd, subCmd: TEST_CMD.bind, data: userId }));
    const response = await ack;
    expect(response.data).toBe(`bound:${userId}`);
  }

  it('未绑定 → sendTo 返回 false；绑定后命中 → true 且客户端收到消息', async () => {
    const ws = await connect();

    expect(server.sendTo(1001n, { type: 'push', n: 1 })).toBe(false);

    await bindUser(ws, '1001');

    const push = nextMessage(ws);
    expect(server.sendTo(1001n, { type: 'push', n: 1 })).toBe(true);
    const message = await push;
    expect(message).toEqual({ type: 'push', n: 1 });

    await closeWebSocket(ws);
  });

  it('userId = 0n 不被绑定，sendTo(0n) 恒为 false', async () => {
    const ws = await connect();
    await bindUser(ws, '0');
    expect(server.sendTo(0n, { type: 'push' })).toBe(false);

    await closeWebSocket(ws);
  });

  it('连接关闭后注册表清理，不再命中', async () => {
    const ws = await connect();
    await bindUser(ws, '1002');
    expect(server.sendTo(1002n, { type: 'push' })).toBe(true);

    await closeWebSocket(ws);
    await delay(100);

    expect(server.sendTo(1002n, { type: 'push' })).toBe(false);
  });

  it('同一 userId 多连接：全部发送，至少命中一个返回 true', async () => {
    const ws1 = await connect();
    const ws2 = await connect();
    await bindUser(ws1, '1003');
    await bindUser(ws2, '1003');

    const p1 = nextMessage(ws1);
    const p2 = nextMessage(ws2);
    expect(server.sendTo(1003n, { type: 'multi' })).toBe(true);
    const [m1, m2] = await Promise.all([p1, p2]);
    expect(m1).toEqual({ type: 'multi' });
    expect(m2).toEqual({ type: 'multi' });

    // 关闭其中一个，余下的仍命中
    await closeWebSocket(ws1);
    await delay(100);
    const p2b = nextMessage(ws2);
    expect(server.sendTo(1003n, { type: 'multi-2' })).toBe(true);
    expect(await p2b).toEqual({ type: 'multi-2' });

    await closeWebSocket(ws2);
  });

  it('broadcast 既有行为不受注册表影响', async () => {
    const ws1 = await connect();
    const ws2 = await connect();
    const messages: any[] = [];
    ws1.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws2.on('message', (data) => messages.push(JSON.parse(data.toString())));

    server.broadcast({ type: 'notification', message: 'all' });
    await delay(120);

    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.type === 'notification')).toBe(true);

    await Promise.all([closeWebSocket(ws1), closeWebSocket(ws2)]);
  });
});
