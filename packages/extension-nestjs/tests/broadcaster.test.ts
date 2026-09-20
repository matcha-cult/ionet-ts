/**
 * 任务 1 / P0-5：Broadcaster 接线到 extension-nestjs。
 *
 * 覆盖三条接缝：
 * 1. 接线：IonetModule.forRoot/forRootAsync 默认提供并导出 IONET_BROADCASTER；
 *    数据源为 WebSocketExternalServer.connectionRegistry（连接注册表适配器）。
 * 2. 注入：Action 经 resolveAction（ActionFactoryBeanForNest）解析时，
 *    其构造器 @Inject(IONET_BROADCASTER) 拿到与容器同一份 Broadcaster 实例。
 * 3. 端到端：握手绑定 userId 后 broadcastToUser 命中且收到 kind=notification 信封；
 *    未绑定 userId 静默完成（不抛错）。
 */

import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { Inject, Injectable, type INestApplication } from '@nestjs/common';
import WebSocket from 'ws';
import {
  ActionController,
  ActionMethod,
  type Broadcaster,
} from '@nbb-ionet/core-framework';
import { IonetModule, IONET_BROADCASTER } from '../src/index.js';

const DISABLED = { httpServer: false, wsServer: false, redis: false } as const;
const DI_CMD = { cmd: 420, ping: 1 } as const;
const E2E_CMD = { cmd: 421, ping: 1 } as const;
const E2E_USER = 8101n;

@ActionController(E2E_CMD.cmd)
class E2eAction {
  @ActionMethod(E2E_CMD.ping)
  ping(): string {
    return 'pong';
  }
}

@Injectable()
@ActionController(DI_CMD.cmd)
class DiAction {
  @ActionMethod(DI_CMD.ping)
  ping(): string {
    return 'pong';
  }

  constructor(@Inject(IONET_BROADCASTER) readonly broadcaster: Broadcaster | null) {}
}

describe('IonetModule Broadcaster provider（任务 1）', () => {
  it('默认提供 IONET_BROADCASTER，且多次解析为同一实例', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IonetModule.forRoot({ actions: [E2eAction], ...DISABLED })],
    }).compile();

    const broadcaster = moduleRef.get<Broadcaster | null>(IONET_BROADCASTER);
    expect(broadcaster).toBeDefined();
    expect(broadcaster).not.toBeNull();
    expect(moduleRef.get(IONET_BROADCASTER)).toBe(broadcaster);

    await moduleRef.close();
  });

  it('broadcaster: false 时不提供（返回 null）', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IonetModule.forRoot({ actions: [E2eAction], ...DISABLED, broadcaster: false })],
    }).compile();

    expect(moduleRef.get(IONET_BROADCASTER)).toBeNull();

    await moduleRef.close();
  });

  it('forRootAsync 同样提供', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRootAsync({
          useFactory: () => ({ actions: [E2eAction], ...DISABLED }),
        }),
      ],
    }).compile();

    expect(moduleRef.get<Broadcaster | null>(IONET_BROADCASTER)).not.toBeNull();

    await moduleRef.close();
  });

  it('Action 经 resolveAction 解析时，DI 注入的 Broadcaster 与容器同一实例', async () => {
    let moduleRef!: TestingModule;
    moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRoot({
          actions: [DiAction],
          resolveAction: (ActionClass) => moduleRef.get(ActionClass),
          ...DISABLED,
        }),
      ],
      providers: [DiAction],
    }).compile();
    await moduleRef.init();

    const action = moduleRef.get<DiAction>(DiAction);
    expect(action.broadcaster).toBeDefined();
    expect(action.broadcaster).toBe(moduleRef.get(IONET_BROADCASTER));

    await moduleRef.close();
  });
});

describe('Broadcaster 端到端推送（任务 1）', () => {
  let app: INestApplication;
  let broadcaster: Broadcaster;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRoot({
          actions: [E2eAction],
          httpServer: false,
          redis: false,
          wsServer: {
            attachNestServer: true,
            path: '/ws',
            authenticate: async () => ({ userId: E2E_USER }),
          },
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.get(IonetModule).attachHttpServer(app.getHttpServer());
    await app.listen(0);
    baseUrl = await app.getUrl();
    broadcaster = app.get<Broadcaster>(IONET_BROADCASTER);
  }, 15000);

  afterAll(async () => {
    await app.close();
  }, 15000);

  function connect(): Promise<WebSocket> {
    const port = new URL(baseUrl).port;
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

  it('broadcastToUser 命中绑定 userId，客户端收到 kind=notification', async () => {
    const ws = await connect();
    await new Promise((r) => setTimeout(r, 80));
    const pending = nextMessage(ws);

    await broadcaster.broadcastToUser(String(E2E_USER), {
      type: 'tick',
      data: { seq: 7 },
      timestamp: 1700000000123,
    });

    const frame = await pending;
    expect(frame.kind).toBe('notification');
    expect(frame.type).toBe('tick');
    expect(frame.data).toEqual({ seq: 7 });
    expect(frame.timestamp).toBe(1700000000123);

    await closeWebSocket(ws);
  });

  it('未绑定 userId：静默完成不抛错', async () => {
    await expect(
      broadcaster.broadcastToUser('424242', { type: 'noop', data: null, timestamp: Date.now() }),
    ).resolves.toBeUndefined();
  });
});
