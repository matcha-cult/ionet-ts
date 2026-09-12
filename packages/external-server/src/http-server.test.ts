import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
} from '@nbb-ionet/core-framework';
import { HttpExternalServer } from './http/http-server.js';

const TEST_CMD = { cmd: 100, echo: 1 } as const;

@ActionController(TEST_CMD.cmd)
class TestAction {
  @ActionMethod(TEST_CMD.echo)
  echo(data: string): string {
    return `echo: ${data}`;
  }
}

describe('HttpExternalServer', () => {
  let server: HttpExternalServer;
  const port = 18080;

  beforeAll(async () => {
    const skeleton = new BarSkeletonBuilder()
      .addAction(TestAction)
      .build();

    server = new HttpExternalServer({ port });
    await server.start(skeleton);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('starts and listens on port', async () => {
    expect(server.port).toBe(port);
    expect(server.protocol).toBe('http');
  });

  it('handles valid request', async () => {
    const response = await fetch(`http://localhost:${port}/api/${TEST_CMD.cmd}/${TEST_CMD.echo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('Hello'),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data).toBe('echo: Hello');
  });

  it('returns 404 for invalid path', async () => {
    const response = await fetch(`http://localhost:${port}/invalid/path`);
    expect(response.status).toBe(404);
  });

  it('returns 400 for invalid JSON', async () => {
    const response = await fetch(`http://localhost:${port}/api/${TEST_CMD.cmd}/${TEST_CMD.echo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json',
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for unknown action', async () => {
    const response = await fetch(`http://localhost:${port}/api/999/999`, {
      method: 'POST',
      body: JSON.stringify(null),
    });
    expect(response.status).toBe(404);
  });
});

describe('HttpExternalServer pathPrefix（P2-2）', () => {
  // 复用同一 TestAction 骨架；每个 server 用独立端口，避免与默认前缀用例互扰。
  const skeleton = new BarSkeletonBuilder().addAction(TestAction).build();
  const port = 18083;
  const barePort = 18084;
  let server: HttpExternalServer;
  let barePrefixServer: HttpExternalServer;

  beforeAll(async () => {
    server = new HttpExternalServer({ port, pathPrefix: '/ionet' });
    await server.start(skeleton);
    barePrefixServer = new HttpExternalServer({ port: barePort, pathPrefix: 'ionet' });
    await barePrefixServer.start(skeleton);
  });

  afterAll(async () => {
    await server.stop();
    await barePrefixServer.stop();
  });

  it('自定义前缀 /ionet 命中', async () => {
    const response = await fetch(`http://localhost:${port}/ionet/${TEST_CMD.cmd}/${TEST_CMD.echo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('Hello'),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data).toBe('echo: Hello');
  });

  it('默认 /api 前缀不再命中（404）', async () => {
    const response = await fetch(`http://localhost:${port}/api/${TEST_CMD.cmd}/${TEST_CMD.echo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('Hello'),
    });
    expect(response.status).toBe(404);
  });

  it('前缀省略前导斜杠等价命中', async () => {
    const response = await fetch(`http://localhost:${barePort}/ionet/${TEST_CMD.cmd}/${TEST_CMD.echo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('Hi'),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data).toBe('echo: Hi');
  });
});
