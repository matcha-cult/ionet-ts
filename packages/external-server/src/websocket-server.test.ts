import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
} from '@ionet/core-framework';
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
