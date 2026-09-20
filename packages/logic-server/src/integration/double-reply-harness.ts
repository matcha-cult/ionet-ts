import 'reflect-metadata';
import { RedisClient, RedisPubSub, RedisRequestReply } from '@nbb-ionet/redis';

/**
 * RS4 失败路径 harness：对同一个 RPC 请求**故意回两次包**（同 correlationId），
 * 验证请求方去重且不二次 resolve。由 cluster.integration.test.ts 跨进程驱动。
 *
 * 环境变量：IONET_INSTANCE_ID / IONET_KEY_PREFIX / IONET_REDIS_PORT
 */
async function main(): Promise<void> {
  const keyPrefix = process.env.IONET_KEY_PREFIX ?? 'ionet:';
  const instanceId = process.env.IONET_INSTANCE_ID;
  if (!instanceId) throw new Error('IONET_INSTANCE_ID is required');

  const client = new RedisClient({
    port: Number(process.env.IONET_REDIS_PORT ?? 6379),
    instanceId,
  });
  await client.connect();
  const pubSub = new RedisPubSub(client);
  await pubSub.connect();

  const rpc = new RedisRequestReply(client, pubSub, {
    keyPrefix,
    instanceId,
    defaultTimeoutMs: 3000,
  });
  await rpc.start();

  rpc.registerHandler('logic.action', (payload, message) => {
    // 手工先发一份同 correlationId 的回包（框架随后还会发正式回包 → 重复回包）
    void pubSub.publish(`${keyPrefix}rpc:${message.replyTo}`, {
      correlationId: message.correlationId,
      kind: 'reply',
      ok: true,
      payload: { data: { source: 'manual-duplicate' } },
      repliedAt: Date.now(),
    });
    void payload;
    return { data: { source: 'primary' } };
  });

  const shutdown = async () => {
    await rpc.stop().catch(() => {});
    await pubSub.disconnect().catch(() => {});
    await client.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  console.log(`READY ${JSON.stringify({ instanceId })}`);
}

void main();
