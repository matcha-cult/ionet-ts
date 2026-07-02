import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MemoryBroadcaster,
  MemoryConnectionRegistry,
  MemoryRoomRegistry,
  type BroadcastMessage,
  type Connection,
} from '../index.js';

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

describe('MemoryBroadcaster', () => {
  let connections: MemoryConnectionRegistry;
  let rooms: MemoryRoomRegistry;
  let broadcaster: MemoryBroadcaster;

  beforeEach(() => {
    connections = new MemoryConnectionRegistry();
    rooms = new MemoryRoomRegistry();
    broadcaster = new MemoryBroadcaster(connections, rooms);
  });

  const createMessage = (type = 'test'): BroadcastMessage => ({
    type,
    data: { hello: 'world' },
    timestamp: Date.now(),
  });

  describe('broadcastToAll', () => {
    it('应该广播给所有本地用户', async () => {
      const conn1 = createMockConnection('c1');
      const conn2 = createMockConnection('c2');
      connections.register('user1', conn1);
      connections.register('user2', conn2);

      await broadcaster.broadcastToAll(createMessage());

      expect(conn1.sent.length).toBe(1);
      expect(conn2.sent.length).toBe(1);
      expect(JSON.parse(conn1.sent[0]).type).toBe('test');
    });

    it('应该跳过未就绪的连接', async () => {
      const conn1 = createMockConnection('c1');
      const conn2 = createMockConnection('c2');
      conn2.close();
      connections.register('user1', conn1);
      connections.register('user2', conn2);

      await broadcaster.broadcastToAll(createMessage());

      expect(conn1.sent.length).toBe(1);
      expect(conn2.sent.length).toBe(0);
    });

    it('没有用户时不应该报错', async () => {
      await expect(broadcaster.broadcastToAll(createMessage())).resolves.toBeUndefined();
    });
  });

  describe('broadcastToUser', () => {
    it('应该广播给指定用户', async () => {
      const conn1 = createMockConnection('c1');
      const conn2 = createMockConnection('c2');
      connections.register('user1', conn1);
      connections.register('user2', conn2);

      await broadcaster.broadcastToUser('user1', createMessage());

      expect(conn1.sent.length).toBe(1);
      expect(conn2.sent.length).toBe(0);
    });

    it('用户不存在时静默处理', async () => {
      await expect(broadcaster.broadcastToUser('nonexistent', createMessage())).resolves.toBeUndefined();
    });
  });

  describe('broadcastToUsers', () => {
    it('应该广播给多个用户', async () => {
      const conn1 = createMockConnection('c1');
      const conn2 = createMockConnection('c2');
      const conn3 = createMockConnection('c3');
      connections.register('user1', conn1);
      connections.register('user2', conn2);
      connections.register('user3', conn3);

      await broadcaster.broadcastToUsers(['user1', 'user3'], createMessage());

      expect(conn1.sent.length).toBe(1);
      expect(conn2.sent.length).toBe(0);
      expect(conn3.sent.length).toBe(1);
    });
  });

  describe('broadcastToRoom', () => {
    it('应该广播给房间内所有成员', async () => {
      const conn1 = createMockConnection('c1');
      const conn2 = createMockConnection('c2');
      const conn3 = createMockConnection('c3');
      connections.register('user1', conn1);
      connections.register('user2', conn2);
      connections.register('user3', conn3);

      await rooms.join('room1', 'user1');
      await rooms.join('room1', 'user2');
      await rooms.join('room2', 'user3');

      await broadcaster.broadcastToRoom('room1', createMessage());

      expect(conn1.sent.length).toBe(1);
      expect(conn2.sent.length).toBe(1);
      expect(conn3.sent.length).toBe(0);
    });

    it('应该支持排除指定用户', async () => {
      const conn1 = createMockConnection('c1');
      const conn2 = createMockConnection('c2');
      connections.register('user1', conn1);
      connections.register('user2', conn2);

      await rooms.join('room1', 'user1');
      await rooms.join('room1', 'user2');

      await broadcaster.broadcastToRoom('room1', createMessage(), 'user1');

      expect(conn1.sent.length).toBe(0);
      expect(conn2.sent.length).toBe(1);
    });

    it('空房间不应该报错', async () => {
      await expect(broadcaster.broadcastToRoom('empty', createMessage())).resolves.toBeUndefined();
    });
  });
});

describe('MemoryConnectionRegistry', () => {
  let registry: MemoryConnectionRegistry;

  beforeEach(() => {
    registry = new MemoryConnectionRegistry();
  });

  it('应该正确注册和获取连接', () => {
    const conn = createMockConnection('c1');
    registry.register('user1', conn);

    expect(registry.isLocalUser('user1')).toBe(true);
    expect(registry.getLocalConnection('user1')).toBe(conn);
  });

  it('应该正确注销连接', () => {
    const conn = createMockConnection('c1');
    registry.register('user1', conn);
    registry.unregister('user1');

    expect(registry.isLocalUser('user1')).toBe(false);
    expect(registry.getLocalConnection('user1')).toBeUndefined();
  });

  it('应该返回所有本地用户', () => {
    const conn1 = createMockConnection('c1');
    const conn2 = createMockConnection('c2');
    registry.register('user1', conn1);
    registry.register('user2', conn2);

    const userIds = registry.getLocalUserIds();
    expect(userIds).toContain('user1');
    expect(userIds).toContain('user2');
    expect(userIds.length).toBe(2);
  });
});

describe('MemoryRoomRegistry', () => {
  let registry: MemoryRoomRegistry;

  beforeEach(() => {
    registry = new MemoryRoomRegistry();
  });

  it('应该正确加入房间', async () => {
    await registry.join('room1', 'user1');
    await registry.join('room1', 'user2');

    const members = await registry.getMembers('room1');
    expect(members).toContain('user1');
    expect(members).toContain('user2');
    expect(members.length).toBe(2);
  });

  it('应该正确离开房间', async () => {
    await registry.join('room1', 'user1');
    await registry.join('room1', 'user2');
    await registry.leave('room1', 'user1');

    const members = await registry.getMembers('room1');
    expect(members).not.toContain('user1');
    expect(members).toContain('user2');
  });

  it('最后一个成员离开后应该清理房间', async () => {
    await registry.join('room1', 'user1');
    await registry.leave('room1', 'user1');

    const members = await registry.getMembers('room1');
    expect(members.length).toBe(0);
    expect(registry.getRoomCount()).toBe(0);
  });
});
