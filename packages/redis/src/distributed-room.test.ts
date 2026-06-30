import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RedisPubSub } from './redis-pub-sub.js';
import { DistributedRoom } from './distributed-room.js';
import { IPC_CHANNELS, type IpcMessage } from './redis-types.js';
import { createMockRedisClient } from './test-helper.js';

describe('DistributedRoom', () => {
  let room: DistributedRoom;
  let pubSub: RedisPubSub;
  let mock: ReturnType<typeof createMockRedisClient>;

  beforeEach(async () => {
    mock = createMockRedisClient('instance-1');
    pubSub = new RedisPubSub(mock.redisClient as never);
    await pubSub.connect();
    room = new DistributedRoom(mock.redisClient as never, pubSub);
    await room.start();
  });

  afterEach(async () => {
    await room.shutdown();
    await pubSub.disconnect();
  });

  describe('createRoom', () => {
    it('should store room metadata in Redis hash', async () => {
      await room.createRoom('room1', { name: 'Test Room', maxMembers: 10 });

      expect(mock.client.hset).toHaveBeenCalledWith(
        'ionet:room:room1',
        'metadata',
        JSON.stringify({ name: 'Test Room', maxMembers: 10 }),
      );
      expect(mock.client.hset).toHaveBeenCalledWith(
        'ionet:room:room1',
        'createdAt',
        expect.any(String),
      );
    });

    it('should create room with empty metadata', async () => {
      await room.createRoom('room1');
      expect(mock.client.hset).toHaveBeenCalledWith(
        'ionet:room:room1',
        'metadata',
        '{}',
      );
    });
  });

  describe('joinRoom', () => {
    it('should add user to Redis set and local members', async () => {
      await room.createRoom('room1', { maxMembers: 10 });
      const result = await room.joinRoom('room1', 'user1');

      expect(result).toBe(true);
      expect(mock.client.sadd).toHaveBeenCalledWith('ionet:room:room1:members', 'user1');
    });

    it('should publish join event to pub/sub', async () => {
      await room.createRoom('room1');
      await room.joinRoom('room1', 'user1');

      expect(mock.client.publish).toHaveBeenCalledTimes(1);
      const [channel, raw] = mock.published[0];
      expect(channel).toBe('ionet:room:event');
      const msg = JSON.parse(raw) as IpcMessage;
      expect(msg.payload).toEqual({
        roomId: 'room1',
        userId: 'user1',
        event: 'join',
      });
    });

    it('should reject join if room does not exist', async () => {
      const result = await room.joinRoom('nonexistent', 'user1');
      expect(result).toBe(false);
    });

    it('should reject join if room is full', async () => {
      await room.createRoom('room1', { maxMembers: 1 });
      mock.setStore.set('ionet:room:room1:members', new Set(['existing-user']));

      const result = await room.joinRoom('room1', 'user1');
      expect(result).toBe(false);
    });

    it('should track user in local members', async () => {
      await room.createRoom('room1');
      await room.joinRoom('room1', 'user1');
      await room.joinRoom('room1', 'user2');

      const localMembers = await room.getLocalMembers('room1');
      expect(localMembers).toContain('user1');
      expect(localMembers).toContain('user2');
    });
  });

  describe('leaveRoom', () => {
    it('should remove user from Redis set and local members', async () => {
      await room.createRoom('room1');
      await room.joinRoom('room1', 'user1');
      await room.leaveRoom('room1', 'user1');

      expect(mock.client.srem).toHaveBeenCalledWith('ionet:room:room1:members', 'user1');

      const localMembers = await room.getLocalMembers('room1');
      expect(localMembers).not.toContain('user1');
    });

    it('should publish leave event', async () => {
      await room.createRoom('room1');
      await room.joinRoom('room1', 'user1');
      await room.leaveRoom('room1', 'user1');

      expect(mock.client.publish).toHaveBeenCalledTimes(2);
      const [, raw] = mock.published[1];
      const msg = JSON.parse(raw) as IpcMessage;
      expect(msg.payload).toEqual({
        roomId: 'room1',
        userId: 'user1',
        event: 'leave',
      });
    });
  });

  describe('destroyRoom', () => {
    it('should delete room metadata and members from Redis', async () => {
      await room.createRoom('room1');
      await room.destroyRoom('room1');

      expect(mock.client.del).toHaveBeenCalledWith('ionet:room:room1');
      expect(mock.client.del).toHaveBeenCalledWith('ionet:room:room1:members');
    });

    it('should publish destroy event', async () => {
      await room.createRoom('room1');
      await room.destroyRoom('room1');

      const msg = JSON.parse(mock.published[0][1]) as IpcMessage;
      expect(msg.payload).toEqual({
        roomId: 'room1',
        userId: '',
        event: 'destroy',
      });
    });

    it('should clear local members', async () => {
      await room.createRoom('room1');
      await room.joinRoom('room1', 'user1');
      await room.destroyRoom('room1');

      const localMembers = await room.getLocalMembers('room1');
      expect(localMembers).toHaveLength(0);
    });
  });

  describe('getRoomMembers', () => {
    it('should return all members from Redis set', async () => {
      mock.setStore.set('ionet:room:room1:members', new Set(['user1', 'user2', 'user3']));

      const members = await room.getRoomMembers('room1');
      expect(members).toHaveLength(3);
      expect(members).toContain('user1');
      expect(members).toContain('user2');
      expect(members).toContain('user3');
    });
  });

  describe('getRoomMetadata', () => {
    it('should return parsed metadata', async () => {
      await room.createRoom('room1', { name: 'Test', maxMembers: 5 });
      const meta = await room.getRoomMetadata('room1');
      expect(meta).toEqual({ name: 'Test', maxMembers: 5 });
    });

    it('should return null for non-existent room', async () => {
      const meta = await room.getRoomMetadata('nonexistent');
      expect(meta).toBeNull();
    });
  });

  describe('broadcastToRoom', () => {
    it('should deliver to local message handlers', async () => {
      const received: Array<{ roomId: string; data: unknown; senderId?: string }> = [];
      room.onRoomMessage((roomId, data, senderId) => {
        received.push({ roomId, data, senderId });
      });

      await room.broadcastToRoom('room1', { text: 'hello' }, 'user1');

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        roomId: 'room1',
        data: { text: 'hello' },
        senderId: 'user1',
      });
    });

    it('should publish room message to pub/sub', async () => {
      await room.broadcastToRoom('room1', { text: 'hello' });

      expect(mock.client.publish).toHaveBeenCalledTimes(1);
      const [channel] = mock.published[0];
      expect(channel).toBe('ionet:room');
    });
  });

  describe('cross-instance events', () => {
    it('should handle remote destroy event by clearing local members', async () => {
      await room.createRoom('room1');
      await room.joinRoom('room1', 'user1');

      const remoteMsg: IpcMessage = {
        sourceInstanceId: 'instance-2',
        type: IPC_CHANNELS.ROOM_EVENT,
        payload: { roomId: 'room1', userId: '', event: 'destroy' },
        timestamp: Date.now(),
      };

      mock.pubSubEmitter.emit('message', 'ionet:room:event', JSON.stringify(remoteMsg));

      const localMembers = await room.getLocalMembers('room1');
      expect(localMembers).toHaveLength(0);
    });

    it('should notify event handlers on remote join', async () => {
      const events: Array<{ roomId: string; event: string; userId: string }> = [];
      room.onRoomEvent((roomId, event, userId) => {
        events.push({ roomId, event, userId });
      });

      const remoteMsg: IpcMessage = {
        sourceInstanceId: 'instance-2',
        type: IPC_CHANNELS.ROOM_EVENT,
        payload: { roomId: 'room1', userId: 'user2', event: 'join' },
        timestamp: Date.now(),
      };

      mock.pubSubEmitter.emit('message', 'ionet:room:event', JSON.stringify(remoteMsg));

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ roomId: 'room1', event: 'join', userId: 'user2' });
    });
  });
});
