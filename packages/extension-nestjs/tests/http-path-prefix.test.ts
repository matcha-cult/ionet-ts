/**
 * P2-2：IonetModule.httpServer.pathPrefix 端到端生效。
 *
 * 覆盖 forRoot 与 forRootAsync 两条链路：自定义前缀命中、默认 /api 不命中，
 * 证明配置经 provider 真正透传到 HttpExternalServer（而非仅类型通过）。
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';
import { IonetModule } from '../src/index.js';

const TEST_CMD = { cmd: 300, echo: 1 } as const;

@ActionController(TEST_CMD.cmd)
class PrefixAction {
  @ActionMethod(TEST_CMD.echo)
  echo(data: string): string {
    return `prefix echo: ${data}`;
  }
}

const FORROOT_PORT = 18090;
const FORROOT_ASYNC_PORT = 18091;

@Module({
  imports: [
    IonetModule.forRoot({
      actions: [PrefixAction],
      httpServer: { enabled: true, port: FORROOT_PORT, host: '127.0.0.1', pathPrefix: '/ionet' },
      wsServer: false,
      redis: false,
    }),
  ],
})
class ForRootPrefixAppModule {}

@Module({
  imports: [
    IonetModule.forRootAsync({
      useFactory: () => ({
        actions: [PrefixAction],
        httpServer: {
          enabled: true,
          port: FORROOT_ASYNC_PORT,
          host: '127.0.0.1',
          pathPrefix: '/async-ionet',
        },
        wsServer: false,
        redis: false,
      }),
    }),
  ],
})
class ForRootAsyncPrefixAppModule {}

async function post(port: number, prefix: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${prefix}/${TEST_CMD.cmd}/${TEST_CMD.echo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify('hello'),
  });
}

describe('IonetModule httpServer.pathPrefix（P2-2）', () => {
  describe('forRoot', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({ imports: [ForRootPrefixAppModule] }).compile();
      await moduleRef.init();
    }, 15000);

    afterAll(async () => {
      await moduleRef.close();
    }, 15000);

    it('自定义前缀 /ionet 命中', async () => {
      const response = await post(FORROOT_PORT, '/ionet');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data).toBe('prefix echo: hello');
    });

    it('默认 /api 不再命中（404）', async () => {
      const response = await post(FORROOT_PORT, '/api');
      expect(response.status).toBe(404);
    });
  });

  describe('forRootAsync', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [ForRootAsyncPrefixAppModule],
      }).compile();
      await moduleRef.init();
    }, 15000);

    afterAll(async () => {
      await moduleRef.close();
    }, 15000);

    it('forRootAsync 也透传 pathPrefix', async () => {
      const response = await post(FORROOT_ASYNC_PORT, '/async-ionet');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data).toBe('prefix echo: hello');
    });
  });
});
