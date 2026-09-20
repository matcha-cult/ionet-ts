import { describe, it, expect, afterEach } from 'vitest';
import {
  OnExternalError,
  OnExternalRegistry,
  type OnExternalContext,
} from '@nbb-ionet/core-framework';
import { RedisClient } from './redis-client.js';
import { RedisPubSub } from './redis-pub-sub.js';
import { RedisOnExternalTransport } from './on-external-transport.js';
import { RedisRequestReply } from './redis-request-reply.js';

describe('OnExternalRegistry', () => {
  it('dispatches to registered handler', async () => {
    const registry = new OnExternalRegistry();
    registry.register({ templateId: 'existUser', process: () => true });
    expect(await registry.dispatch({ templateId: 'existUser', payload: {} })).toBe(true);
  });

  it('throws explicitly when no handler is registered', async () => {
    const registry = new OnExternalRegistry();
    await expect(registry.dispatch({ templateId: 'nope', payload: {} })).rejects.toBeInstanceOf(
      OnExternalError,
    );
  });

  it('wraps handler failures as HANDLER_ERROR', async () => {
    const registry = new OnExternalRegistry();
    registry.register({
      templateId: 'boom',
      process: () => {
        throw new Error('inner');
      },
    });
    await expect(registry.dispatch({ templateId: 'boom', payload: {} })).rejects.toMatchObject({
      code: 'HANDLER_ERROR',
    });
  });
});

/**
 * RS6 —— OnExternal 的 Redis 传输（定向 / 广播）与 RPC 应答（existUser）真实 Redis 集成测试。
 */
describe('RedisOnExternalTransport (RS6)', () => {
  const cleanups: Array<() => Promise<void>> = [];

  function track(fn: () => Promise<void>): void {
    cleanups.push(fn);
  }

  async function createPeer(instanceId: string): Promise<{
    client: RedisClient;
    pubSub: RedisPubSub;
  }> {
    const client = new RedisClient({ instanceId });
    await client.connect();
    const pubSub = new RedisPubSub(client);
    await pubSub.connect();
    track(() => pubSub.disconnect().catch(() => {}));
    track(() => client.disconnect().catch(() => {}));
    return { client, pubSub };
  }

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  it('delivers targeted OnExternal and supports RPC request/response', async () => {
    const receiver = await createPeer(`ext-${Math.random().toString(36).slice(2)}`);
    const sender = await createPeer(`logic-${Math.random().toString(36).slice(2)}`);

    const received: OnExternalContext[] = [];
    const registry = new OnExternalRegistry();
    registry.register({
      templateId: 'forceOffline',
      process: (context) => {
        received.push(context);
        return true;
      },
    });
    registry.register({
      templateId: 'existUser',
      process: (context) => context.userId === 'u-online',
    });

    const receiverRpc = new RedisRequestReply(receiver.client, receiver.pubSub, {
      instanceId: receiver.client.getInstanceId(),
      defaultTimeoutMs: 500,
    });
    await receiverRpc.start();
    receiverRpc.registerHandler('external.onExternal', (payload) =>
      registry.dispatch(payload as OnExternalContext),
    );
    track(() => receiverRpc.stop());

    const transport = new RedisOnExternalTransport(
      receiver.client,
      receiver.pubSub,
      registry,
      { instanceId: receiver.client.getInstanceId() },
    );
    await transport.start();
    track(() => transport.stop());

    const senderTransport = new RedisOnExternalTransport(sender.client, sender.pubSub, null, {
      instanceId: sender.client.getInstanceId(),
    });

    await senderTransport.send(
      { templateId: 'forceOffline', userId: 'u1', payload: {} },
      receiver.client.getInstanceId(),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(received.map((c) => c.userId)).toEqual(['u1']);

    const senderRpc = new RedisRequestReply(sender.client, sender.pubSub, {
      instanceId: sender.client.getInstanceId(),
      defaultTimeoutMs: 500,
    });
    await senderRpc.start();
    track(() => senderRpc.stop());

    const online = await senderRpc.call<boolean>(
      receiver.client.getInstanceId(),
      'external.onExternal',
      { templateId: 'existUser', userId: 'u-online', payload: {} } satisfies OnExternalContext,
    );
    expect(online).toBe(true);
  });

  it('broadcasts OnExternal to all subscribed external instances', async () => {
    const receiverA = await createPeer(`ext-a-${Math.random().toString(36).slice(2)}`);
    const receiverB = await createPeer(`ext-b-${Math.random().toString(36).slice(2)}`);
    const sender = await createPeer(`logic-${Math.random().toString(36).slice(2)}`);

    const hits: string[] = [];
    const makeReceiver = async (peer: { client: RedisClient; pubSub: RedisPubSub }, label: string) => {
      const registry = new OnExternalRegistry();
      registry.register({ templateId: 'ping', process: () => { hits.push(label); } });
      const transport = new RedisOnExternalTransport(peer.client, peer.pubSub, registry, {
        instanceId: peer.client.getInstanceId(),
      });
      await transport.start();
      track(() => transport.stop());
    };

    await makeReceiver(receiverA, 'a');
    await makeReceiver(receiverB, 'b');

    const senderTransport = new RedisOnExternalTransport(sender.client, sender.pubSub, null, {
      instanceId: sender.client.getInstanceId(),
    });
    await senderTransport.send({ templateId: 'ping', payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(hits.sort()).toEqual(['a', 'b']);
  });
});
