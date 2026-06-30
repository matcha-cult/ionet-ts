import { vi } from 'vitest';
import { EventEmitter } from 'node:events';

export function createMockRedisClient(instanceId = 'test-instance') {
  const store = new Map<string, string>();
  const hashStore = new Map<string, Map<string, string>>();
  const setStore = new Map<string, Set<string>>();
  const pubSubEmitter = new EventEmitter();
  const published: Array<[string, string]> = [];
  const subscriptions = new Set<string>();
  const patternSubscriptions = new Set<string>();

  const client = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.length >= 2 && args[0] === 'PX') {
        store.set(key, value);
      } else if (args.length >= 2 && args[0] === 'EX') {
        store.set(key, value);
      } else if (args.length >= 2 && args[0] === 'NX') {
        if (store.has(key)) return null;
        store.set(key, value);
      } else if (
        args.length >= 4 &&
        args[0] === 'PX' &&
        args[2] === 'NX'
      ) {
        if (store.has(key)) return null;
        store.set(key, value);
      } else {
        store.set(key, value);
      }
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      let count = 0;
      if (store.delete(key)) count++;
      if (hashStore.delete(key)) count++;
      if (setStore.delete(key)) count++;
      return count;
    }),
    publish: vi.fn(async (channel: string, message: string) => {
      published.push([channel, message]);
      if (subscriptions.has(channel)) {
        setTimeout(() => pubSubEmitter.emit('message', channel, message), 0);
      }
      return 1;
    }),
    eval: vi.fn(async (script: string, numKeys: number, ...args: unknown[]) => {
      const keys = args.slice(0, numKeys) as string[];
      const argv = args.slice(numKeys) as string[];

      if (script.includes('get') && script.includes('del')) {
        const val = store.get(keys[0]);
        if (val === argv[0]) {
          store.delete(keys[0]);
          return 1;
        }
        return 0;
      }

      if (script.includes('pexpire')) {
        const val = store.get(keys[0]);
        if (val === argv[0]) return 1;
        return 0;
      }

      return 0;
    }),
    hset: vi.fn(async (key: string, field: string, value: string) => {
      let hash = hashStore.get(key);
      if (!hash) {
        hash = new Map();
        hashStore.set(key, hash);
      }
      const isNew = !hash.has(field);
      hash.set(field, value);
      return isNew ? 1 : 0;
    }),
    hget: vi.fn(async (key: string, field: string) => {
      return hashStore.get(key)?.get(field) ?? null;
    }),
    hdel: vi.fn(async (key: string, field: string) => {
      const hash = hashStore.get(key);
      if (!hash) return 0;
      return hash.delete(field) ? 1 : 0;
    }),
    hgetall: vi.fn(async (key: string) => {
      const hash = hashStore.get(key);
      if (!hash) return {};
      return Object.fromEntries(hash);
    }),
    sadd: vi.fn(async (key: string, member: string) => {
      let set = setStore.get(key);
      if (!set) {
        set = new Set();
        setStore.set(key, set);
      }
      const isNew = !set.has(member);
      set.add(member);
      return isNew ? 1 : 0;
    }),
    srem: vi.fn(async (key: string, member: string) => {
      const set = setStore.get(key);
      if (!set) return 0;
      return set.delete(member) ? 1 : 0;
    }),
    smembers: vi.fn(async (key: string) => {
      return [...(setStore.get(key) ?? [])];
    }),
    scard: vi.fn(async (key: string) => {
      return setStore.get(key)?.size ?? 0;
    }),
  };

  const subscriber = {
    subscribe: vi.fn(async (channel: string) => {
      subscriptions.add(channel);
    }),
    unsubscribe: vi.fn(async (channel?: string) => {
      if (channel) subscriptions.delete(channel);
      else subscriptions.clear();
    }),
    psubscribe: vi.fn(async (pattern: string) => {
      patternSubscriptions.add(pattern);
    }),
    punsubscribe: vi.fn(async (pattern?: string) => {
      if (pattern) patternSubscriptions.delete(pattern);
      else patternSubscriptions.clear();
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      pubSubEmitter.on(event, handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      pubSubEmitter.off(event, handler);
    }),
    quit: vi.fn(async () => {}),
  };

  const redisClient = {
    getClient: vi.fn(() => client),
    getSubscriber: vi.fn(() => subscriber),
    getInstanceId: vi.fn(() => instanceId),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    ping: vi.fn(async () => true),
    getStatus: vi.fn(() => 'connected' as const),
    onStatusChange: vi.fn(() => () => {}),
  };

  return {
    redisClient,
    client,
    subscriber,
    pubSubEmitter,
    published,
    subscriptions,
    patternSubscriptions,
    store,
    hashStore,
    setStore,
  };
}
