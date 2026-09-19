import 'reflect-metadata';
import { BarSkeletonBuilder } from '@nbb-ionet/core-framework';
import { WebSocketExternalServer } from '@nbb-ionet/external-server';
import { RedisClient, RedisPubSub } from '@nbb-ionet/redis';
import { ExternalServerRuntime } from '../index.js';

/**
 * 多进程集成测试用的对外服子进程 harness：
 * 只有对外服（无本地 Action），所有请求都应转发给逻辑服。
 *
 * 环境变量：
 * - IONET_PORT：WS 监听端口
 * - IONET_INSTANCE_ID / IONET_KEY_PREFIX / IONET_REDIS_PORT
 * - IONET_HEARTBEAT_MS / IONET_HEARTBEAT_TIMEOUT_MS
 */
async function main(): Promise<void> {
  const port = Number(process.env.IONET_PORT);
  if (!port) throw new Error('IONET_PORT is required');
  const keyPrefix = process.env.IONET_KEY_PREFIX ?? 'ionet:';
  const heartbeatIntervalMs = Number(process.env.IONET_HEARTBEAT_MS ?? 200);
  const heartbeatTimeoutMs = Number(process.env.IONET_HEARTBEAT_TIMEOUT_MS ?? 1500);

  const wsServer = new WebSocketExternalServer({
    port,
    path: '/ws',
    // 握手即绑定 userId（跨进程连接表登记所需）
    authenticate: async ({ url }) => {
      const parsed = new URL(url, 'http://localhost');
      const raw = parsed.searchParams.get('userId');
      if (!raw) return null;
      return { userId: BigInt(raw) };
    },
  });

  const redisClient = new RedisClient({
    port: Number(process.env.IONET_REDIS_PORT ?? 6379),
    instanceId: process.env.IONET_INSTANCE_ID,
  });
  await redisClient.connect();
  const pubSub = new RedisPubSub(redisClient);
  await pubSub.connect();

  const skeleton = new BarSkeletonBuilder().build();

  const runtime = await ExternalServerRuntime.start({
    server: wsServer,
    wsServer,
    redisClient,
    pubSub,
    keyPrefix,
    instanceId: process.env.IONET_INSTANCE_ID,
    serverName: 'TestExternalServer',
    serverTag: 'external',
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    // 对外服 → 逻辑服的外层调用预算必须显著大于逻辑服之间的内层调用预算，
    // 否则「逻辑服内部调用超时后返回错误信封」会被外层提前截断成无 data 的超时。
    defaultCallTimeoutMs: 5000,
    skeleton,
  });

  await wsServer.start(skeleton);

  const shutdown = async () => {
    await wsServer.stop().catch(() => {});
    await runtime.stop().catch(() => {});
    await pubSub.disconnect().catch(() => {});
    await redisClient.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  console.log(
    `READY ${JSON.stringify({
      instanceId: runtime.instanceId,
      port,
      cmdMerges: runtime.serverRecord.cmdMerges,
    })}`,
  );
}

void main();
