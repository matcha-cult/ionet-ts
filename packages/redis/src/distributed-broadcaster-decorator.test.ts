import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MemoryBroadcaster,
  MemoryConnectionRegistry,
  MemoryRoomRegistry,
  type Broadcaster,
  type Connection,
} from '@nbb-ionet/core-framework';
import { DistributedBroadcasterDecorator } from './distributed-broadcaster-decorator.js';
import { RedisClient } from './redis-client.js';
import { RedisPubSub } from './redis-pub-sub.js';

function createMockConnection(id: string): Connection & { sent: string[] } {
  const conn = {
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
  return conn;
}

describe('DistributedBroadcasterDecorator', () => {
  let redisClient: RedisClient;
  let pubSub: RedisPubSub;
  let connections: MemoryConnectionRegistry;
  let rooms: MemoryRoomRegistry;
  let localBroadcaster: Broadcaster;
  let distributed: DistributedBroadcasterDecorator;

  beforeEach(async () => {
    redisClient = new RedisClient({ host: 'localhost', port: 6379 });
    await redisClient.connect();

    pubSub = new RedisPubSub(redisClient);
    await pubSub.connect();

    connections = new MemoryConnectionRegistry();
    rooms = new MemoryRoomRegistry();
    localBroadcaster = new MemoryBroadcaster(connections, rooms);

    distributed = new DistributedBroadcasterDecorator(localBroadcaster, pubSub, connections, rooms);
    await distributed.start();
  });

  afterEach(async () => {
    await distributed.stop();
    await pubSub.disconnect();
    await redisClient.disconnect();
  });

  describe('broadcastToAll', () => {
    it('应该先广播到本地，然后通过 Redis 扩散', async () => {
      const conn1 = createMockConnection('c1');
      connections.register('user1', conn1);

      await distributed.broadcastToAll({
        type: 'test',
        data: { hello: 'world' },
        timestamp: Date.now(),
      });

      // 本地用户应该收到消息
      expect(conn1.sent.length).toBe(1);
    });
  });

  describe('broadcastToUser', () => {
    it('本地用户应该直接发送，不走 Redis', async () => {
      const conn1 = createMockConnection('c1');
      connections.register('user1', conn1);

      await distributed.broadcastToUser('user1', {
        type: 'test',
        data: { hello: 'world' },
        timestamp: Date.now(),
      });

      expect(conn1.sent.length).toBe(1);
    });

    it('远程用户应该通过 Redis 扩散', async () => {
      // user2 不在本地
      await distributed.broadcastToUser('user2', {
        type: 'test',
        data: { hello: 'world' },
        timestamp: Date.now(),
      });

      // 没有报错，消息通过 Redis 发布
    });
  });

  describe('broadcastToRoom', () => {
    it('应该先广播到本地房间成员，然后通过 Redis 扩散', async () => {
      const conn1 = createMockConnection('c1');
      const conn2 = createMockConnection('c2');
      connections.register('user1', conn1);
      connections.register('user2', conn2);

      await rooms.join('room1', 'user1');
      await rooms.join('room1', 'user2');

      await distributed.broadcastToRoom('room1', {
        type: 'test',
        data: { hello: 'world' },
        timestamp: Date.now(),
      });

      expect(conn1.sent.length).toBe(1);
      expect(conn2.sent.length).toBe(1);
    });

    it('应该支持排除指定用户', async () => {
      const conn1 = createMockConnection('c1');
      const conn2 = createMockConnection('c2');
      connections.register('user1', conn1);
      connections.register('user2', conn2);

      await rooms.join('room1', 'user1');
      await rooms.join('room1', 'user2');

      await distributed.broadcastToRoom('room1', {
        type: 'test',
        data: { hello: 'world' },
        timestamp: Date.now(),
      }, 'user1');

      expect(conn1.sent.length).toBe(0);
      expect(conn2.sent.length).toBe(1);
    });
  });
});

import { afterEach } from 'vitest';
