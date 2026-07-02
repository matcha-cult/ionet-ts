import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DistributedRoomExtended } from './distributed-room-extended.js';
import { RedisClient } from './redis-client.js';
import { RedisPubSub } from './redis-pub-sub.js';
import { IPC_CHANNELS } from './redis-types.js';

describe('DistributedRoomExtended', () => {
  let redisClient: RedisClient;
  let pubSub: RedisPubSub;
  let room: DistributedRoomExtended;

  beforeEach(async () => {
    redisClient = new RedisClient({ host: 'localhost', port: 6379 });
    await redisClient.connect();

    // Clean up test data
    const keys = await redisClient.getClient().keys('test*');
    if (keys.length > 0) {
      await redisClient.getClient().del(...keys);
    }

    pubSub = new RedisPubSub(redisClient);
    await pubSub.connect();

    room = new DistributedRoomExtended(redisClient, pubSub, { keyPrefix: 'test:' });
    await room.start();
  });

  afterEach(async () => {
    await room.shutdown();
    await pubSub.disconnect();
    await redisClient.disconnect();
  });

  describe('房间属性动态修改', () => {
    it('应该允许 owner 修改房间属性', async () => {
      await room.createRoom('room1', 'user1', { name: 'Room 1', maxMembers: 10 });

      const updated = await room.updateRoomMetadata('room1', 'user1', { name: 'Updated Room' });
      expect(updated).toBe(true);

      const metadata = await room.getRoomMetadata('room1');
      expect(metadata?.name).toBe('Updated Room');
    });

    it('应该拒绝非 owner/admin 修改房间属性', async () => {
      await room.createRoom('room1', 'user1', { name: 'Room 1' });
      await room.joinRoom('room1', 'user2');

      const updated = await room.updateRoomMetadata('room1', 'user2', { name: 'Updated' });
      expect(updated).toBe(false);
    });
  });

  describe('房间成员角色', () => {
    it('应该正确设置和获取成员角色', async () => {
      await room.createRoom('room1', 'user1');
      await room.joinRoom('room1', 'user2');

      const role = await room.getMemberRole('room1', 'user1');
      expect(role).toBe('owner');

      const memberRole = await room.getMemberRole('room1', 'user2');
      expect(memberRole).toBe('member');
    });

    it('应该允许 owner 提升成员为 admin', async () => {
      await room.createRoom('room1', 'user1');
      await room.joinRoom('room1', 'user2');

      const success = await room.setMemberRole('room1', 'user1', 'user2', 'admin');
      expect(success).toBe(true);

      const role = await room.getMemberRole('room1', 'user2');
      expect(role).toBe('admin');
    });

    it('应该拒绝非 owner 修改角色', async () => {
      await room.createRoom('room1', 'user1');
      await room.joinRoom('room1', 'user2');
      await room.joinRoom('room1', 'user3');

      const success = await room.setMemberRole('room1', 'user2', 'user3', 'admin');
      expect(success).toBe(false);
    });
  });

  describe('房间消息历史', () => {
    it('应该保存消息历史', async () => {
      const testRoom = new DistributedRoomExtended(redisClient, pubSub, { keyPrefix: 'test-history:' });
      await testRoom.start();

      await testRoom.createRoom('room1', 'user1');

      await testRoom.broadcastToRoom('room1', { text: 'Hello' }, { messageType: 'chat' });
      await testRoom.broadcastToRoom('room1', { text: 'World' }, { messageType: 'chat' });

      const history = await testRoom.getMessageHistory('room1', 10);
      expect(history.length).toBe(2);
      expect(history[0].messageType).toBe('chat');

      await testRoom.shutdown();
    });

    it('应该限制历史消息数量', async () => {
      const smallRoom = new DistributedRoomExtended(redisClient, pubSub, {
        keyPrefix: 'test:',
        maxHistorySize: 3,
      });
      await smallRoom.start();

      await smallRoom.createRoom('room2', 'user1');

      for (let i = 0; i < 5; i++) {
        await smallRoom.broadcastToRoom('room2', { index: i });
      }

      const history = await smallRoom.getMessageHistory('room2', 10);
      expect(history.length).toBe(3);

      await smallRoom.shutdown();
    });
  });

  describe('房间搜索与列表', () => {
    it('应该列出所有房间', async () => {
      await room.createRoom('room1', 'user1', { name: 'Room 1' });
      await room.createRoom('room2', 'user2', { name: 'Room 2' });

      const rooms = await room.listRooms();
      expect(rooms.length).toBeGreaterThanOrEqual(2);
      expect(rooms).toContain('room1');
      expect(rooms).toContain('room2');
    });

    it('应该支持按名称搜索', async () => {
      await room.createRoom('room1', 'user1', { name: 'Game Room' });
      await room.createRoom('room2', 'user2', { name: 'Chat Room' });

      const rooms = await room.listRooms({ namePattern: 'Game*' });
      expect(rooms).toContain('room1');
      expect(rooms).not.toContain('room2');
    });

    it('应该支持按成员数过滤', async () => {
      await room.createRoom('room1', 'user1', { name: 'Room 1', maxMembers: 10 });
      await room.joinRoom('room1', 'user2');
      await room.joinRoom('room1', 'user3');

      await room.createRoom('room2', 'user4', { name: 'Room 2', maxMembers: 10 });
      await room.joinRoom('room2', 'user5');

      const rooms = await room.listRooms({ minMembers: 2 });
      expect(rooms).toContain('room1');
      expect(rooms).toContain('room2');
    });

    it('应该支持按密码过滤', async () => {
      await room.createRoom('room1', 'user1', { name: 'Public Room' });
      await room.createRoom('room2', 'user2', { name: 'Private Room', password: 'secret' });

      const publicRooms = await room.listRooms({ hasPassword: false });
      expect(publicRooms).toContain('room1');
      expect(publicRooms).not.toContain('room2');
    });
  });

  describe('房间事件钩子', () => {
    it('应该触发 onRoomCreate 钩子', async () => {
      let triggered = false;
      room.onRoomCreate((roomId, event, userId) => {
        triggered = true;
        expect(roomId).toBe('room1');
        expect(userId).toBe('user1');
      });

      await room.createRoom('room1', 'user1');
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(triggered).toBe(true);
    });

    it('应该触发 onUserJoin 钩子', async () => {
      await room.createRoom('room1', 'user1');

      let triggered = false;
      room.onUserJoin((roomId, event, userId) => {
        triggered = true;
        expect(roomId).toBe('room1');
        expect(userId).toBe('user2');
      });

      await room.joinRoom('room1', 'user2');
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(triggered).toBe(true);
    });

    it('应该触发 onRoomMessage 钩子', async () => {
      await room.createRoom('room1', 'user1');

      let triggered = false;
      room.onRoomMessage((roomId, data, senderId, messageType) => {
        triggered = true;
        expect(roomId).toBe('room1');
        expect(data).toEqual({ text: 'Hello' });
        expect(messageType).toBe('chat');
      });

      await room.broadcastToRoom('room1', { text: 'Hello' }, { messageType: 'chat' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(triggered).toBe(true);
    });
  });

  describe('房间范围广播', () => {
    it('应该支持排除特定用户', async () => {
      await room.createRoom('room1', 'user1');
      await room.joinRoom('room1', 'user2');
      await room.joinRoom('room1', 'user3');

      const received: string[] = [];

      room.onRoomMessage((roomId, data, senderId) => {
        received.push(senderId ?? 'unknown');
      });

      await room.broadcastToRoom('room1', { text: 'Hello' }, { excludeUserId: 'user2' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(received.length).toBeGreaterThan(0);
    });

    it('应该支持消息类型过滤', async () => {
      const testRoom = new DistributedRoomExtended(redisClient, pubSub, { keyPrefix: 'test-filter:' });
      await testRoom.start();

      await testRoom.createRoom('room1', 'user1');

      const receivedMessages: Array<{ data: unknown; messageType?: string }> = [];

      testRoom.onRoomMessage((roomId, data, senderId, messageType) => {
        receivedMessages.push({ data, messageType });
      });

      await testRoom.broadcastToRoom('room1', { text: 'Hello' }, { messageType: 'chat' });
      await testRoom.broadcastToRoom('room1', { text: 'User joined' }, { messageType: 'system' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const chatMessages = receivedMessages.filter(m => m.messageType === 'chat');
      const systemMessages = receivedMessages.filter(m => m.messageType === 'system');

      expect(chatMessages.length).toBeGreaterThanOrEqual(1);
      expect(systemMessages.length).toBeGreaterThanOrEqual(1);

      await testRoom.shutdown();
    });
  });
});
