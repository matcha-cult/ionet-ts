import { describe, it, expect, afterEach } from 'vitest';
import {
  MemoryBroadcaster,
  MemoryConnectionRegistry,
  MemoryRoomRegistry,
  type Broadcaster,
  type Connection,
} from '@nbb-ionet/core-framework';
import {
  ConnectionOwnerOfflineError,
  ConnectionOwnerUnknownError,
  DistributedBroadcasterDecorator,
  type ConnectionOwnerStore,
} from './distributed-broadcaster-decorator.js';
import { RedisClient } from './redis-client.js';
import { RedisPubSub } from './redis-pub-sub.js';

function createMockConnection(id: string): Connection & { sent: string[] } {
  return {
    id,
    ready: true,
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    close() {
      this.ready = false;
    },
  };
}

/**
 * RS6 —— 跨进程定向推送：连接归属表 + 定向通道 + 宕机显式报错。
 */
describe('DistributedBroadcasterDecorator targeted delivery (RS6)', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  async function createDecorator(instanceId: string, options: {
    connections: MemoryConnectionRegistry;
    store?: ConnectionOwnerStore;
    isAlive?: (id: string) => Promise<boolean>;
  }): Promise<{ client: RedisClient; pubSub: RedisPubSub; decorator: DistributedBroadcasterDecorator; local: Broadcaster }> {
    const client = new RedisClient({ instanceId });
    await client.connect();
    const pubSub = new RedisPubSub(client);
    await pubSub.connect();
    const local = new MemoryBroadcaster(options.connections, new MemoryRoomRegistry());
    const decorator = new DistributedBroadcasterDecorator(
      local,
      pubSub,
      options.connections,
      new MemoryRoomRegistry(),
      { instanceId, connectionStore: options.store, isInstanceAlive: options.isAlive },
    );
    await decorator.start();
    cleanups.push(async () => {
      await decorator.stop().catch(() => {});
      await pubSub.disconnect().catch(() => {});
      await client.disconnect().catch(() => {});
    });
    return { client, pubSub, decorator, local };
  }

  it('routes a remote user push to the owning instance targeted channel', async () => {
    const ownerConnections = new MemoryConnectionRegistry();
    const ownerConn = createMockConnection('c-owner');
    ownerConnections.register('user-42', ownerConn);

    const owner = await createDecorator(`owner-${Math.random().toString(36).slice(2)}`, {
      connections: ownerConnections,
    });
    const publisher = await createDecorator(`pub-${Math.random().toString(36).slice(2)}`, {
      connections: new MemoryConnectionRegistry(),
      store: { lookup: async () => owner.client.getInstanceId() },
      isAlive: async () => true,
    });

    await publisher.decorator.broadcastToUser('user-42', {
      type: 'rs6-targeted',
      data: { tick: 1 },
      timestamp: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const mine = ownerConn.sent.filter((raw) => raw.includes('rs6-targeted'));
    expect(mine).toHaveLength(1);
  });

  it('throws ConnectionOwnerUnknownError when no instance owns the user', async () => {
    const publisher = await createDecorator(`pub-${Math.random().toString(36).slice(2)}`, {
      connections: new MemoryConnectionRegistry(),
      store: { lookup: async () => null },
      isAlive: async () => true,
    });

    await expect(
      publisher.decorator.broadcastToUser('ghost', {
        type: 'frame',
        data: {},
        timestamp: Date.now(),
      }),
    ).rejects.toBeInstanceOf(ConnectionOwnerUnknownError);
  });

  it('throws ConnectionOwnerOfflineError when the owning instance is down (no silent drop)', async () => {
    const publisher = await createDecorator(`pub-${Math.random().toString(36).slice(2)}`, {
      connections: new MemoryConnectionRegistry(),
      store: { lookup: async () => 'dead-instance' },
      isAlive: async () => false,
    });

    const error = await publisher.decorator
      .broadcastToUser('user-9', { type: 'frame', data: {}, timestamp: Date.now() })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConnectionOwnerOfflineError);
    expect((error as ConnectionOwnerOfflineError).instanceId).toBe('dead-instance');
  });

  it('delivers locally without touching Redis when the user is local', async () => {
    const connections = new MemoryConnectionRegistry();
    const conn = createMockConnection('c-local');
    connections.register('local-user', conn);

    const decorator = await createDecorator(`local-${Math.random().toString(36).slice(2)}`, {
      connections,
      store: {
        lookup: async () => {
          throw new Error('lookup must not be called for local users');
        },
      },
      isAlive: async () => true,
    });

    await decorator.decorator.broadcastToUser('local-user', {
      type: 'rs6-local',
      data: { ok: true },
      timestamp: Date.now(),
    });
    const mine = conn.sent.filter((raw) => raw.includes('rs6-local'));
    expect(mine).toHaveLength(1);
  });
});
