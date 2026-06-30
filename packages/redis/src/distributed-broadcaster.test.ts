import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RedisPubSub } from './redis-pub-sub.js';
import { DistributedBroadcaster } from './distributed-broadcaster.js';
import { IPC_CHANNELS, type IpcMessage } from './redis-types.js';
import { createMockRedisClient } from './test-helper.js';

describe('DistributedBroadcaster', () => {
  let broadcaster: DistributedBroadcaster;
  let pubSub: RedisPubSub;
  let mock: ReturnType<typeof createMockRedisClient>;

  beforeEach(async () => {
    mock = createMockRedisClient('instance-1');
    pubSub = new RedisPubSub(mock.redisClient as never);
    await pubSub.connect();
    broadcaster = new DistributedBroadcaster(mock.redisClient as never, pubSub);
    await broadcaster.start();
  });

  afterEach(async () => {
    await broadcaster.shutdown();
    await pubSub.disconnect();
  });

  describe('local user management', () => {
    it('should register local user', () => {
      broadcaster.registerLocalUser('user1', () => {});
      expect(broadcaster.getLocalConnectionCount()).toBe(1);
    });

    it('should unregister local user', () => {
      broadcaster.registerLocalUser('user1', () => {});
      broadcaster.unregisterLocalUser('user1');
      expect(broadcaster.getLocalConnectionCount()).toBe(0);
    });

    it('should write user-instance mapping to Redis', () => {
      broadcaster.registerLocalUser('user1', () => {});
      expect(mock.client.hset).toHaveBeenCalledWith(
        'ionet:user-instance',
        'user1',
        'instance-1',
      );
    });

    it('should remove user-instance mapping on unregister', () => {
      broadcaster.registerLocalUser('user1', () => {});
      broadcaster.unregisterLocalUser('user1');
      expect(mock.client.hdel).toHaveBeenCalledWith('ionet:user-instance', 'user1');
    });

    it('should support multiple handlers for same user', () => {
      const received1: unknown[] = [];
      const received2: unknown[] = [];

      broadcaster.registerLocalUser('user1', (data) => received1.push(data));
      broadcaster.registerLocalUser('user1', (data) => received2.push(data));

      expect(broadcaster.getLocalConnectionCount()).toBe(1);
    });
  });

  describe('broadcastToAll', () => {
    it('should deliver to local users via global handler', async () => {
      const received: unknown[] = [];
      broadcaster.onGlobalBroadcast((data) => received.push(data));

      await broadcaster.broadcastToAll({ text: 'hello' });

      expect(received).toEqual([{ text: 'hello' }]);
    });

    it('should deliver to local user handlers', async () => {
      const received: unknown[] = [];
      broadcaster.registerLocalUser('user1', (data) => received.push(data));

      await broadcaster.broadcastToAll({ text: 'hello' });

      expect(received).toEqual([{ text: 'hello' }]);
    });

    it('should exclude specified userId', async () => {
      const received: unknown[] = [];
      broadcaster.registerLocalUser('user1', (data) => received.push(data));
      broadcaster.registerLocalUser('user2', (data) => received.push(data));

      await broadcaster.broadcastToAll({ text: 'hello' }, 'user1');

      expect(received).toHaveLength(1);
    });

    it('should publish to Redis pub/sub', async () => {
      await broadcaster.broadcastToAll({ text: 'hello' });

      expect(mock.client.publish).toHaveBeenCalledTimes(1);
      const [channel, raw] = mock.published[0];
      expect(channel).toBe('ionet:broadcast');
      const msg = JSON.parse(raw) as IpcMessage;
      expect(msg.payload).toEqual({ data: { text: 'hello' }, excludeUserId: undefined });
    });
  });

  describe('broadcastToUser', () => {
    it('should deliver to local user directly', async () => {
      const received: unknown[] = [];
      broadcaster.registerLocalUser('user1', (data) => received.push(data));

      await broadcaster.broadcastToUser('user1', { text: 'pm' });

      expect(received).toEqual([{ text: 'pm' }]);
    });

    it('should not publish to Redis when user is local', async () => {
      broadcaster.registerLocalUser('user1', () => {});

      await broadcaster.broadcastToUser('user1', { text: 'pm' });

      expect(mock.client.publish).not.toHaveBeenCalled();
    });

    it('should publish to Redis when user is not local', async () => {
      mock.hashStore.set('ionet:user-instance', new Map([['user2', 'instance-2']]));

      await broadcaster.broadcastToUser('user2', { text: 'pm' });

      expect(mock.client.publish).toHaveBeenCalledTimes(1);
      const [channel] = mock.published[0];
      expect(channel).toBe('ionet:user');
    });
  });

  describe('cross-instance message delivery', () => {
    it('should deliver remote broadcast to local users', async () => {
      const received: unknown[] = [];
      broadcaster.registerLocalUser('user1', (data) => received.push(data));

      const remoteMsg: IpcMessage = {
        sourceInstanceId: 'instance-2',
        type: IPC_CHANNELS.BROADCAST,
        payload: { data: { text: 'from remote' } },
        timestamp: Date.now(),
      };

      mock.pubSubEmitter.emit('message', 'ionet:broadcast', JSON.stringify(remoteMsg));

      expect(received).toEqual([{ text: 'from remote' }]);
    });

    it('should deliver remote user message to local user', async () => {
      const received: unknown[] = [];
      broadcaster.registerLocalUser('user1', (data) => received.push(data));

      const remoteMsg: IpcMessage = {
        sourceInstanceId: 'instance-2',
        type: IPC_CHANNELS.USER_MESSAGE,
        payload: { userId: 'user1', data: { text: 'from remote' } },
        timestamp: Date.now(),
      };

      mock.pubSubEmitter.emit('message', 'ionet:user', JSON.stringify(remoteMsg));

      expect(received).toEqual([{ text: 'from remote' }]);
    });
  });

  describe('shutdown', () => {
    it('should unregister all local users', async () => {
      broadcaster.registerLocalUser('user1', () => {});
      broadcaster.registerLocalUser('user2', () => {});

      await broadcaster.shutdown();
      expect(broadcaster.getLocalConnectionCount()).toBe(0);
    });
  });
});
