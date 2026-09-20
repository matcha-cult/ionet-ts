/**
 * IonetModule attachNestServer 端到端接线测试。
 *
 * 覆盖的关键接缝（端口三合一方案的设计要害）：
 * 1. attach 模式的 http.Server 由应用侧推送：beforeAll 复刻 main.ts 的接线顺序——
 *    createNestApplication → app.get(IonetModule).attachHttpServer(app.getHttpServer())
 *    → listen；跨仓库 workspace 链接下 @nestjs/core 类令牌（HttpAdapterHost）注入
 *    静默降级为 undefined（两份物理副本），推送式接线（http.Server 为 node 内置对象、
 *    IonetModule 为同一 workspace 副本）是唯一身份安全的路径。
 * 2. attach 模式 start() 不得等待 'listening'（NestJS listen 晚于 onModuleInit），否则死锁——
 *    beforeAll 超时即暴露。
 * 3. 同一 listener 上 express 路由与 ws upgrade 共存互扰为零。
 * 4. app.close() 不挂起：onModuleDestroy 先终止 ws 客户端、摘除 upgrade，http server 由 NestJS 关闭。
 * 5. 未推送 server 时 onModuleInit 抛明确错误（指引 app.get(IonetModule).attachHttpServer）。
 */

import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import WebSocket from 'ws';
import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';
import { IonetModule } from '../src/ionet.module.js';

const TEST_CMD = { cmd: 200, echo: 1 } as const;

@ActionController(TEST_CMD.cmd)
class TestAction {
  @ActionMethod(TEST_CMD.echo)
  echo(data: string): string {
    return `nest attach echo: ${data}`;
  }
}

/** 模拟应用侧 express 路由（三合一中与 ws upgrade 共享同一 http.Server） */
@Controller('probe')
class ProbeController {
  @Get()
  ok(): { http: string } {
    return { http: 'express side ok' };
  }
}

@Module({
  imports: [
    IonetModule.forRoot({
      actions: [TestAction],
      wsServer: { attachNestServer: true, path: '/ws' },
    }),
  ],
  controllers: [ProbeController],
})
class AttachTestAppModule {}

describe('IonetModule attachNestServer 端到端接线', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AttachTestAppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // 推送式接线（与生产 main.ts 同形）：须在 init/listen 之前
    app.get(IonetModule).attachHttpServer(app.getHttpServer());
    await app.listen(0);
    baseUrl = await app.getUrl();
  }, 15000);

  afterAll(async () => {
    // 不得挂起：ws 客户端先被 terminate，upgrade 摘除后 NestJS 关闭 http server
    await app.close();
  }, 15000);

  it('onModuleInit 取得 http.Server，ws 挂载于 NestJS 同一 listener', async () => {
    const port = new URL(baseUrl).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const responsePromise = new Promise<{ data?: string }>((resolve) => {
      ws.once('message', (d) => resolve(JSON.parse(d.toString())));
    });
    ws.send(JSON.stringify({ cmd: TEST_CMD.cmd, subCmd: TEST_CMD.echo, data: 'via-nest' }));

    const response = await responsePromise;
    expect(response.data).toBe('nest attach echo: via-nest');
    ws.close();
  });

  it('同 server 的 express 路由不受 ws attach 影响', async () => {
    const res = await fetch(`${baseUrl}/probe`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ http: 'express side ok' });
  });

  it('非 /ws 路径 upgrade 被拒（400）', async () => {
    const port = new URL(baseUrl).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/not-ws`);
    const status = await new Promise<number>((resolve, reject) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? -1));
      ws.on('error', () => {
        /* 400 后的伴随 error；以 unexpected-response 为准 */
      });
      ws.on('open', () => reject(new Error('非 /ws 路径不应握手成功')));
    });
    expect(status).toBe(400);
  });
});

describe('attachNestServer 缺少 HTTP 上下文', () => {
  it('纯 DI 容器（未创建 NestApplication）init 抛明确错误', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AttachTestAppModule],
    }).compile();
    await expect(moduleRef.init()).rejects.toThrow(/attachNestServer/);
    // NestApplicationContext.close() 会先 await 已 rejected 的 initializationPromise
    // （nest-application-context.js close()），把 init 的错误原样再抛一次；清理需容忍。
    await expect(moduleRef.close()).rejects.toThrow(/attachNestServer/);
  });
});
