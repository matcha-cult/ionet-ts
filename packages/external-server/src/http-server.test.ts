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
