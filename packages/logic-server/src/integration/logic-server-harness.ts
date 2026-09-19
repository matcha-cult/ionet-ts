import 'reflect-metadata';
import {
  ActionController,
  ActionMethod,
  getCurrentFlowContext,
  type BarSkeleton,
  type BarSkeletonBuilder,
} from '@nbb-ionet/core-framework';
import { RedisClient, RedisPubSub } from '@nbb-ionet/redis';
import {
  LogicServerHost,
  startLogicServer,
  type LogicServer,
  type ServerBuilder,
} from '../index.js';

/**
 * 多进程集成测试用的逻辑服子进程 harness。
 * 由 cluster.integration.test.ts 经 tsx 启动；READY 行报告实例 id 与路由数。
 *
 * 环境变量：
 * - IONET_ROLE=battle|map|dupbattle
 * - IONET_INSTANCE_ID / IONET_SERVER_NAME
 * - IONET_KEY_PREFIX / IONET_REDIS_PORT
 * - IONET_HEARTBEAT_MS / IONET_HEARTBEAT_TIMEOUT_MS
 */

export const BATTLE_CMD = { cmd: 101 } as const;
export const MAP_CMD = { cmd: 201 } as const;

/** 由 harness 注入，供 Action 访问本进程逻辑服运行时（广播 / OnExternal）。 */
let hostRef: LogicServerHost | null = null;

@ActionController(BATTLE_CMD.cmd)
class BattleAction {
  @ActionMethod(1)
  echo(data: unknown): { server: string; value: unknown } {
    return { server: 'battle', value: data };
  }

  @ActionMethod(2)
  async callMap(data: unknown): Promise<unknown> {
    const ctx = getCurrentFlowContext()!;
    const response = await ctx.call(MAP_CMD.cmd, 1, data);
    if (response.errorCode) {
      return { fromBattle: true, errorCode: response.errorCode, errorMessage: response.errorMessage };
    }
    return { fromBattle: true, map: response.data };
  }

  @ActionMethod(3)
  bindUser(): { bound: string } {
    const ctx = getCurrentFlowContext()!;
    ctx.bindingUserId(777n);
    return { bound: '777' };
  }

  @ActionMethod(4)
  async pushToUser(data: {
    userId: string;
    text: string;
  }): Promise<{ pushed: boolean; code?: string; message?: string }> {
    try {
      await hostRef!.broadcaster.broadcastToUser(data.userId, {
        type: 'battle-push',
        data: { text: data.text },
        timestamp: Date.now(),
      });
      return { pushed: true };
    } catch (error) {
      const e = error as { code?: string; name?: string; message?: string };
      return { pushed: false, code: e.code ?? e.name, message: e.message };
    }
  }

  @ActionMethod(5)
  async forceOffline(data: { userId: string }): Promise<{ delivered: boolean }> {
    const delivered = await hostRef!.externalCommunication.forceOffline(data.userId);
    return { delivered };
  }

  /** 以显式超时调用 map 的慢 Action；callAsync 不抛出，返回错误信封。 */
  @ActionMethod(6)
  async callMapWithTimeout(data: { ms: number; timeoutMs: number }): Promise<unknown> {
    const ctx = getCurrentFlowContext()!;
    const response = await ctx.callAsync(
      MAP_CMD.cmd,
      2,
      { ms: data.ms },
      { timeoutMs: data.timeoutMs },
    );
    return { errorCode: response.errorCode, errorMessage: response.errorMessage, data: response.data };
  }

  /** 严格调用 map；失败时把 CrossServerError.code 原样带回（用于区分 NOT_REGISTERED / PEER_OFFLINE）。 */
  @ActionMethod(7)
  async callMapStrict(): Promise<unknown> {
    const ctx = getCurrentFlowContext()!;
    try {
      const response = await ctx.call(MAP_CMD.cmd, 1, {});
      return { ok: true, data: response.data };
    } catch (error) {
      const e = error as { code?: string; errorCode?: number; message?: string };
      return { ok: false, code: e.code, errorCode: e.errorCode, message: e.message };
    }
  }

  /** 单向 send 到 map（不等待响应）。 */
  @ActionMethod(8)
  fireAndForget(data: { ms: number }): { sent: boolean } {
    const ctx = getCurrentFlowContext()!;
    ctx.send(MAP_CMD.cmd, 2, { ms: data.ms });
    return { sent: true };
  }
}

@ActionController(MAP_CMD.cmd)
class MapAction {
  @ActionMethod(1)
  mapInfo(data: unknown): { server: string; map: string; value: unknown } {
    return { server: 'map', map: 'map-1', value: data };
  }

  @ActionMethod(2)
  async slow(data: { ms: number }): Promise<{ server: string; slept: number }> {
    await new Promise((resolve) => setTimeout(resolve, data.ms));
    return { server: 'map', slept: data.ms };
  }

  @ActionMethod(3)
  async neverRespond(): Promise<never> {
    await new Promise(() => {});
    throw new Error('unreachable');
  }
}

class BattleLogicServer implements LogicServer {
  settingBarSkeletonBuilder(builder: BarSkeletonBuilder): void {
    builder.addAction(BattleAction);
  }

  settingServerBuilder(builder: ServerBuilder): void {
    builder.setName('BattleLogicServer');
    builder.setTag('battle');
  }

  startupSuccess(barSkeleton: BarSkeleton): void {
    void barSkeleton;
  }
}

class MapLogicServer implements LogicServer {
  settingBarSkeletonBuilder(builder: BarSkeletonBuilder): void {
    builder.addAction(MapAction);
  }

  settingServerBuilder(builder: ServerBuilder): void {
    builder.setName('MapLogicServer');
    builder.setTag('map');
  }
}

async function main(): Promise<void> {
  const role = process.env.IONET_ROLE ?? 'battle';
  const keyPrefix = process.env.IONET_KEY_PREFIX ?? 'ionet:';
  const heartbeatIntervalMs = Number(process.env.IONET_HEARTBEAT_MS ?? 200);
  const heartbeatTimeoutMs = Number(process.env.IONET_HEARTBEAT_TIMEOUT_MS ?? 1500);

  const redisClient = new RedisClient({
    port: Number(process.env.IONET_REDIS_PORT ?? 6379),
    instanceId: process.env.IONET_INSTANCE_ID,
  });
  await redisClient.connect();
  const pubSub = new RedisPubSub(redisClient);
  await pubSub.connect();

  // dupbattle：故意复用 battle 的路由，用于验证 RS8 启动期跨进程重复路由检测。
  let logicServer: LogicServer;
  if (role === 'dupbattle') {
    logicServer = new BattleLogicServer();
  } else if (role === 'map') {
    logicServer = new MapLogicServer();
  } else {
    logicServer = new BattleLogicServer();
  }

  let host: LogicServerHost;
  try {
    host = await startLogicServer({
      logicServer,
      redisClient,
      pubSub,
      keyPrefix,
      instanceId: process.env.IONET_INSTANCE_ID,
      heartbeatIntervalMs,
      heartbeatTimeoutMs,
      defaultCallTimeoutMs: 800,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`STARTUP_FAILED ${message}`);
    await pubSub.disconnect().catch(() => {});
    await redisClient.disconnect().catch(() => {});
    process.exit(1);
  }

  hostRef = host;

  const shutdown = async () => {
    await host.stop().catch(() => {});
    await pubSub.disconnect().catch(() => {});
    await redisClient.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  // READY 行：包含实例 id 与 cmdMerges，供测试断言注册元数据
  console.log(
    `READY ${JSON.stringify({
      instanceId: host.serverRecord.id,
      name: host.serverRecord.name,
      tag: host.serverRecord.tag,
      cmdMerges: host.serverRecord.cmdMerges,
    })}`,
  );
}

void main();
