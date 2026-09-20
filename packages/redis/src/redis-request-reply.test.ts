import { describe, it, expect, afterEach } from 'vitest';
import { RedisClient } from './redis-client.js';
import { RedisPubSub } from './redis-pub-sub.js';
import {
  RedisRequestReply,
  RpcPeerError,
  RpcTimeoutError,
  type RpcRequestMessage,
} from './redis-request-reply.js';

/**
 * RS4 —— Redis 请求/响应 RPC 的真实 Redis 集成测试。
 * 覆盖：正常回包、无 handler、超时、重复回包去重、迟到回包、单向发送。
 */
describe('RedisRequestReply (RS4)', () => {
  const resources: Array<{ stop(): Promise<void> }> = [];

  async function createPeer(suffix: string): Promise<{
    client: RedisClient;
    pubSub: RedisPubSub;
    rpc: RedisRequestReply;
  }> {
    const client = new RedisClient({ instanceId: `rpc-${suffix}-${Math.random().toString(36).slice(2)}` });
    await client.connect();
    const pubSub = new RedisPubSub(client);
    await pubSub.connect();
    const rpc = new RedisRequestReply(client, pubSub, { defaultTimeoutMs: 300 });
    await rpc.start();
    resources.push({ stop: () => client.disconnect() });
    resources.push({ stop: () => pubSub.disconnect() });
    resources.push({ stop: () => rpc.stop() });
    return { client, pubSub, rpc };
  }

  afterEach(async () => {
    while (resources.length > 0) {
      const resource = resources.pop()!;
      await resource.stop().catch(() => {});
    }
  });

  it('resolves request/response across instances', async () => {
    const a = await createPeer('a');
    const b = await createPeer('b');
    b.rpc.registerHandler('echo', (payload) => ({ echoed: payload }));

    const reply = await a.rpc.call(b.rpc.getInstanceId(), 'echo', { x: 1 });
    expect(reply).toEqual({ echoed: { x: 1 } });
    expect(a.rpc.getStats().pending).toBe(0);
  });

  it('rejects with RpcPeerError when remote has no handler', async () => {
    const a = await createPeer('a');
    const b = await createPeer('b');
    await expect(a.rpc.call(b.rpc.getInstanceId(), 'missing', {})).rejects.toBeInstanceOf(
      RpcPeerError,
    );
  });

  it('rejects with RpcPeerError when remote handler throws', async () => {
    const a = await createPeer('a');
    const b = await createPeer('b');
    b.rpc.registerHandler('boom', () => {
      throw new Error('handler exploded');
    });
    await expect(a.rpc.call(b.rpc.getInstanceId(), 'boom', {})).rejects.toThrow(
      'handler exploded',
    );
  });

  it('rejects with RpcTimeoutError when no reply arrives', async () => {
    const a = await createPeer('a');
    const error = await a.rpc
      .call('nobody-here', 'echo', {}, { timeoutMs: 120 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(RpcTimeoutError);
    expect((error as RpcTimeoutError).timeoutMs).toBe(120);
    expect(a.rpc.getStats().pending).toBe(0);
  });

  it('deduplicates duplicate replies and does not double-resolve', async () => {
    const a = await createPeer('a');
    const b = await createPeer('b');
    let captured: RpcRequestMessage | null = null;
    b.rpc.registerHandler('slow', async (payload, message) => {
      captured = message;
      return { ok: payload };
    });

    const reply = await a.rpc.call(b.rpc.getInstanceId(), 'slow', 7);
    expect(reply).toEqual({ ok: 7 });

    // 手动重复投递同一 correlationId 的回包
    const duplicate = {
      correlationId: captured!.correlationId,
      kind: 'reply' as const,
      ok: true,
      payload: { ok: 7 },
      repliedAt: Date.now(),
    };
    await a.pubSub.publish(a.rpc.getChannel(), duplicate);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(a.rpc.getStats().duplicateReplies).toBeGreaterThanOrEqual(1);
  });

  it('counts late replies for unknown correlation ids', async () => {
    const a = await createPeer('a');
    await a.pubSub.publish(a.rpc.getChannel(), {
      correlationId: 'never-issued',
      kind: 'reply',
      ok: true,
      payload: 1,
      repliedAt: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(a.rpc.getStats().lateReplies).toBeGreaterThanOrEqual(1);
  });

  it('send executes remote handler without reply', async () => {
    const a = await createPeer('a');
    const b = await createPeer('b');
    const received: unknown[] = [];
    b.rpc.registerHandler('event', (payload) => {
      received.push(payload);
    });

    await a.rpc.send(b.rpc.getInstanceId(), 'event', { n: 1 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(received).toEqual([{ n: 1 }]);
    expect(a.rpc.getStats().pending).toBe(0);
  });
});
