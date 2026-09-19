import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { ActionController, ActionMethod, MemoryBroadcaster } from '@nbb-ionet/core-framework';
import { DistributedBroadcasterDecorator, RedisClient, RedisSessionStore } from '@nbb-ionet/redis';
import { IonetModule } from '../src/ionet.module.js';
import {
  IONET_BAR_SKELETON,
  IONET_BROADCASTER,
  IONET_EXTERNAL_RUNTIME,
  IONET_REDIS_CLIENT,
  IONET_SESSION_STORE,
} from '../src/ionet.constants.js';

const PROBE_CMD = { cmd: 77, ping: 1 } as const;

@ActionController(PROBE_CMD.cmd)
class ProbeAction {
  @ActionMethod(PROBE_CMD.ping)
  ping(): string {
    return 'pong';
  }
}

function runId(): string {
  return Math.random().toString(36).slice(2, 8);
}

const REDIS_PORT = Number(process.env.IONET_TEST_REDIS_PORT ?? 6379);

/**
 * RS7 —— extension-nestjs 分布式接线。
 * 断言：开启 redis/distributed 后广播/会话/路由走 Redis；关闭时单实例行为不变。
 */
describe('IonetModule distributed wiring (RS7)', () => {
  it('redis + distributed 开启：注册表/路由器/分布式广播/Redis 会话全部接线', async () => {
    const id = runId();
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRoot({
          actions: [ProbeAction],
          httpServer: false,
          wsServer: { port: 0 },
          redis: { port: REDIS_PORT, instanceId: `nest-${id}` },
          distributed: {
            keyPrefix: `nest-${id}:`,
            heartbeatIntervalMs: 200,
            heartbeatTimeoutMs: 1500,
          },
          session: { enabled: true },
        }),
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const runtime = app.get(IONET_EXTERNAL_RUNTIME);
      expect(runtime).toBeTruthy();
      expect(runtime!.instanceId).toBe(`nest-${id}`);
      expect(runtime!.serverRecord.serverType).toBe('external');

      // 广播走分布式装饰器（定向通道），而非进程内 MemoryBroadcaster
      const broadcaster = app.get(IONET_BROADCASTER);
      expect(broadcaster).toBeInstanceOf(DistributedBroadcasterDecorator);

      // 骨架安装跨服路由器：本地未命中的请求会转发给逻辑服
      const skeleton = app.get(IONET_BAR_SKELETON);
      expect(skeleton.hasCrossServerRouter()).toBe(true);

      // 会话走 Redis
      expect(app.get(IONET_SESSION_STORE)).toBeInstanceOf(RedisSessionStore);
    } finally {
      await app.close();
    }
  }, 30000);

  it('redis 关闭：单实例行为不变（MemoryBroadcaster / 无运行时 / 无 Redis 会话）', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRoot({
          actions: [ProbeAction],
          httpServer: false,
          wsServer: { port: 0 },
          redis: false,
        }),
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      expect(app.get(IONET_REDIS_CLIENT)).toBeNull();
      expect(app.get(IONET_EXTERNAL_RUNTIME)).toBeNull();
      expect(app.get(IONET_SESSION_STORE)).toBeNull();
      expect(app.get(IONET_BROADCASTER)).toBeInstanceOf(MemoryBroadcaster);
      expect(app.get(IONET_BAR_SKELETON).hasCrossServerRouter()).toBe(false);
    } finally {
      await app.close();
    }
  }, 30000);

  it('redis: true 被接受（默认连接参数）', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRoot({
          actions: [ProbeAction],
          httpServer: false,
          wsServer: false,
          redis: true,
        }),
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      const client = app.get(IONET_REDIS_CLIENT) as RedisClient | null;
      expect(client).toBeTruthy();
      expect(client!.getStatus()).toBe('connected');
      // 无对外服时分布式运行时缺省不启用（无法承载 OnExternal）
      expect(app.get(IONET_EXTERNAL_RUNTIME)).toBeNull();
    } finally {
      await app.close();
    }
  }, 30000);
});
