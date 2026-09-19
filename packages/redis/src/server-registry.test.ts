import { describe, it, expect, afterEach } from 'vitest';
import { RedisClient } from './redis-client.js';
import { RedisPubSub } from './redis-pub-sub.js';
import { ServerRegistry, type ServerRecord } from './server-registry.js';
import { ConnectionRegistryStore } from './connection-registry-store.js';

function uniquePrefix(tag: string): string {
  return `test-${tag}-${Math.random().toString(36).slice(2)}:`;
}

describe('ServerRegistry (RS2)', () => {
  const cleanups: Array<() => Promise<void>> = [];

  async function createRegistry(prefix: string, instanceId: string): Promise<{
    client: RedisClient;
    pubSub: RedisPubSub;
    registry: ServerRegistry;
  }> {
    const client = new RedisClient({ instanceId });
    await client.connect();
    const pubSub = new RedisPubSub(client);
    await pubSub.connect();
    const registry = new ServerRegistry(client, pubSub, {
      keyPrefix: prefix,
      heartbeatIntervalMs: 50,
      // 放宽超时：并行 worker 负载下事件循环可能被抢占数百毫秒，
      // 过紧的 500ms 会让刚注册的记录被误判为下线（测试假失败）。
      heartbeatTimeoutMs: 5000,
      cacheTtlMs: 0,
    });
    await registry.start();
    cleanups.push(async () => {
      await registry.stop().catch(() => {});
      await pubSub.disconnect().catch(() => {});
      await client.disconnect().catch(() => {});
    });
    return { client, pubSub, registry };
  }

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  function logicRecord(id: string, name: string, cmdMerges: number[]): Omit<ServerRecord, 'lastHeartbeat'> {
    return {
      id,
      name,
      tag: name,
      serverType: 'logic',
      cmdMerges,
      startedAt: Date.now(),
      ip: '127.0.0.1',
    };
  }

  it('registers, discovers and resolves cmdMerge to logic server', async () => {
    const prefix = uniquePrefix('reg');
    const battle = await createRegistry(prefix, 'battle-1');
    const map = await createRegistry(prefix, 'map-1');

    await battle.registry.register(logicRecord('battle-1', 'BattleLogicServer', [101, 102]));
    await map.registry.register(logicRecord('map-1', 'MapLogicServer', [201]));

    const alive = await map.registry.listAlive();
    expect(alive.map((r) => r.id).sort()).toEqual(['battle-1', 'map-1']);
    expect((await map.registry.findServerByCmdMerge(101))?.id).toBe('battle-1');
    expect((await map.registry.findServerByCmdMerge(201))?.id).toBe('map-1');
    expect(await map.registry.findServerByCmdMerge(999)).toBeNull();
  });

  it('unregister removes the server and marks it not alive', async () => {
    const prefix = uniquePrefix('reg');
    const registry = await createRegistry(prefix, 'solo-1');
    await registry.registry.register(logicRecord('solo-1', 'Solo', [1]));
    expect(await registry.registry.isAlive('solo-1')).toBe(true);

    await registry.registry.unregister('solo-1');
    expect(await registry.registry.isAlive('solo-1')).toBe(false);
    expect(await registry.registry.listAlive()).toHaveLength(0);
  });

  it('reports cross-process duplicate cmdMerge owners (RS8)', async () => {
    const prefix = uniquePrefix('dup');
    const a = await createRegistry(prefix, 'dup-a');
    const b = await createRegistry(prefix, 'dup-b');
    await a.registry.register(logicRecord('dup-a', 'BattleLogicServer', [555]));
    await b.registry.register(logicRecord('dup-b', 'OtherLogicServer', [555]));

    const duplicates = await a.registry.detectDuplicates();
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].cmdMerge).toBe(555);
    expect(duplicates[0].servers.map((s) => s.id).sort()).toEqual(['dup-a', 'dup-b']);
  });

  it('finds servers by tag', async () => {
    const prefix = uniquePrefix('tag');
    const a = await createRegistry(prefix, 't-1');
    await a.registry.register({
      ...logicRecord('t-1', 'BattleA', [1]),
      tag: 'battle',
    });
    const servers = await a.registry.findServersByTag('battle');
    expect(servers.map((s) => s.id)).toEqual(['t-1']);
  });
});

describe('ConnectionRegistryStore (RS6)', () => {
  const cleanups: Array<() => Promise<void>> = [];

  async function createStore(prefix: string, instanceId: string) {
    const client = new RedisClient({ instanceId });
    await client.connect();
    const store = new ConnectionRegistryStore(client, { keyPrefix: prefix });
    cleanups.push(async () => {
      await client.disconnect().catch(() => {});
    });
    return store;
  }

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
  });

  it('binds, looks up and unbinds a user connection', async () => {
    const store = await createStore(uniquePrefix('conn'), 'ext-1');
    await store.bind('user-1', 'ext-1');
    expect(await store.lookup('user-1')).toBe('ext-1');
    expect(await store.listUsers('ext-1')).toEqual(['user-1']);
    expect(await store.count('ext-1')).toBe(1);

    await store.unbind('user-1');
    expect(await store.lookup('user-1')).toBeNull();
    expect(await store.listUsers('ext-1')).toEqual([]);
  });

  it('unbindInstance clears all users of a crashed instance', async () => {
    const store = await createStore(uniquePrefix('conn'), 'ext-2');
    await store.bind('u1', 'ext-2');
    await store.bind('u2', 'ext-2');
    await store.unbindInstance('ext-2');

    expect(await store.lookup('u1')).toBeNull();
    expect(await store.lookup('u2')).toBeNull();
    expect(await store.listUsers('ext-2')).toEqual([]);
  });
});
