import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import WebSocket from 'ws';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
} from '@nbb-ionet/core-framework';
import { WebSocketExternalServer } from './websocket/ws-server.js';

const TEST_CMD = { cmd: 200, echo: 1 } as const;

@ActionController(TEST_CMD.cmd)
class TestAction {
  @ActionMethod(TEST_CMD.echo)
  echo(data: string): string {
    return `ws echo: ${data}`;
  }
}

describe('WebSocketExternalServer', () => {
  let server: WebSocketExternalServer;
  const port = 18081;

  beforeAll(async () => {
    const skeleton = new BarSkeletonBuilder()
      .addAction(TestAction)
      .build();

    server = new WebSocketExternalServer({ port, path: '/ws' });
    await server.start(skeleton);
  });

  afterAll(async () => {
    await server.stop();
  });

  function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
  }

  function waitForMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
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

  it('starts and listens on port', () => {
    expect(server.port).toBe(port);
    expect(server.protocol).toBe('ws');
  });

  it('handles valid WebSocket message', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await waitForOpen(ws);

    const responsePromise = waitForMessage(ws);
    ws.send(JSON.stringify({ cmd: TEST_CMD.cmd, subCmd: TEST_CMD.echo, data: 'Hello' }));

    const response = await responsePromise;
    expect(response.data).toBe('ws echo: Hello');

    await closeWebSocket(ws);
  });

  it('handles invalid message format', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await waitForOpen(ws);

    const responsePromise = waitForMessage(ws);
    ws.send('invalid json');

    const response = await responsePromise;
    expect(response.errorCode).toBe(400);

    await closeWebSocket(ws);
  });

  it('broadcast sends to all clients', async () => {
    const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
    const ws2 = new WebSocket(`ws://localhost:${port}/ws`);

    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    const messages: any[] = [];
    ws1.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws2.on('message', (data) => messages.push(JSON.parse(data.toString())));

    server.broadcast({ type: 'notification', message: 'test' });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('notification');
    expect(messages[1].type).toBe('notification');

    await Promise.all([closeWebSocket(ws1), closeWebSocket(ws2)]);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('tracks client count', async () => {
    const initialCount = server.clientCount;

    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await waitForOpen(ws);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.clientCount).toBe(initialCount + 1);

    await closeWebSocket(ws);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(server.clientCount).toBe(initialCount);
  });
});

describe('WebSocketExternalServer attach 模式（共享既有 http.Server）', () => {
  let httpServer: Server;
  let wsServer: WebSocketExternalServer;
  let httpPort: number;

  beforeAll(async () => {
    // 裸 http.Server 模拟 NestJS/express 宿主：'request' 监听器与 ws 的 'upgrade' 正交
    httpServer = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ http: 'express-side response unaffected' }));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    httpPort = (httpServer.address() as AddressInfo).port;

    const skeleton = new BarSkeletonBuilder().addAction(TestAction).build();
    wsServer = new WebSocketExternalServer({ server: httpServer, path: '/ws' });
    await wsServer.start(skeleton);
  });

  afterAll(async () => {
    await wsServer.stop();
    // 关键断言：stop() 不得关闭共享的 http.Server（ws 不持有所有权，由宿主的停机序列负责）
    expect(httpServer.listening).toBe(true);
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  });

  function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
  }

  function waitForMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  it('attach 模式下 port getter 返回 -1（无独立端口）', () => {
    expect(wsServer.port).toBe(-1);
    expect(wsServer.protocol).toBe('ws');
  });

  it('ws 客户端经共享 server 完成请求/响应信封', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
    await waitForOpen(ws);

    const responsePromise = waitForMessage(ws);
    ws.send(JSON.stringify({ cmd: TEST_CMD.cmd, subCmd: TEST_CMD.echo, data: 'attach' }));

    const response = await responsePromise;
    expect(response.data).toBe('ws echo: attach');

    ws.close();
  });

  it('同 server 的普通 HTTP 请求（模拟 express）不受影响', async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/api/anything`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { http: string };
    expect(body.http).toBe('express-side response unaffected');
  });

  it('非 /ws 路径的 upgrade 请求被拒绝（400，ws 原生 path 过滤）', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/other-path`);
    const status = await new Promise<number>((resolve, reject) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? -1));
      ws.on('error', () => {
        /* 400 拒绝后 ws 客户端还会派发 error；以 unexpected-response 为准 */
      });
      ws.on('open', () => reject(new Error('非 /ws 路径不应握手成功')));
    });
    expect(status).toBe(400);
  });
});

describe('WebSocketExternalServer 选项校验', () => {
  it('port 与 server 同时给出 → 构造即抛错', () => {
    const bare = createServer();
    try {
      expect(
        () => new WebSocketExternalServer({ port: 18099, server: bare }),
      ).toThrow(/互斥/);
    } finally {
      bare.closeAllConnections?.();
      bare.close();
    }
  });

  it('既无 port 也无 server 时 start → 明确错误', async () => {
    const wsServer = new WebSocketExternalServer({});
    const skeleton = new BarSkeletonBuilder().addAction(TestAction).build();
    await expect(wsServer.start(skeleton)).rejects.toThrow(/未给出/);
  });
});
