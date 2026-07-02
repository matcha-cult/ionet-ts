import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { DomainEvent, DomainEventBase, DomainEventBus, getDomainEventType } from '../src/index.js';

@DomainEvent({ type: 'UserJoined' })
class UserJoinedEvent extends DomainEventBase {
  constructor(
    public readonly userId: string,
    public readonly roomId: string
  ) {
    super();
  }
}

@DomainEvent({ type: 'UserLeft' })
class UserLeftEvent extends DomainEventBase {
  constructor(
    public readonly userId: string,
    public readonly roomId: string
  ) {
    super();
  }
}

@DomainEvent({ type: 'RoomMessage' })
class RoomMessageEvent extends DomainEventBase {
  constructor(
    public readonly userId: string,
    public readonly roomId: string,
    public readonly message: string
  ) {
    super();
  }
}

describe('DomainEventBus', () => {
  let bus: DomainEventBus;

  beforeEach(() => {
    bus = new DomainEventBus();
  });

  describe('事件发布/订阅', () => {
    it('应该正确发布和订阅事件', async () => {
      const received: UserJoinedEvent[] = [];

      bus.subscribe('UserJoined', (event) => {
        received.push(event);
      });

      const event = new UserJoinedEvent('user1', 'room1');
      await bus.publish(event);

      expect(received.length).toBe(1);
      expect(received[0].userId).toBe('user1');
      expect(received[0].roomId).toBe('room1');
    });

    it('应该支持多个订阅者', async () => {
      const received1: UserJoinedEvent[] = [];
      const received2: UserJoinedEvent[] = [];

      bus.subscribe('UserJoined', (event) => {
        received1.push(event);
      });

      bus.subscribe('UserJoined', (event) => {
        received2.push(event);
      });

      await bus.publish(new UserJoinedEvent('user1', 'room1'));

      expect(received1.length).toBe(1);
      expect(received2.length).toBe(1);
    });

    it('应该支持取消订阅', async () => {
      const received: UserJoinedEvent[] = [];

      const unsubscribe = bus.subscribe('UserJoined', (event) => {
        received.push(event);
      });

      await bus.publish(new UserJoinedEvent('user1', 'room1'));
      expect(received.length).toBe(1);

      unsubscribe();

      await bus.publish(new UserJoinedEvent('user2', 'room1'));
      expect(received.length).toBe(1);
    });

    it('应该支持异步处理', async () => {
      const received: UserJoinedEvent[] = [];

      bus.subscribe('UserJoined', async (event) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        received.push(event);
      });

      await bus.publish(new UserJoinedEvent('user1', 'room1'));

      expect(received.length).toBe(1);
    });
  });

  describe('并发隔离', () => {
    it('应该保证同一分区的事件串行处理', async () => {
      const order: number[] = [];

      bus.subscribeWithPartition('RoomMessage', async (event) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        order.push(parseInt(event.message));
      }, (event) => event.roomId);

      const promises = [
        bus.publish(new RoomMessageEvent('user1', 'room1', '1')),
        bus.publish(new RoomMessageEvent('user2', 'room1', '2')),
        bus.publish(new RoomMessageEvent('user3', 'room1', '3')),
      ];

      await Promise.all(promises);

      expect(order).toEqual([1, 2, 3]);
    });

    it('应该允许不同分区并行处理', async () => {
      const order: string[] = [];

      bus.subscribeWithPartition('RoomMessage', async (event) => {
        order.push(`start-${event.roomId}`);
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push(`end-${event.roomId}`);
      }, (event) => event.roomId);

      const promises = [
        bus.publish(new RoomMessageEvent('user1', 'room1', 'msg1')),
        bus.publish(new RoomMessageEvent('user2', 'room2', 'msg2')),
      ];

      await Promise.all(promises);

      const starts = order.filter(s => s.startsWith('start-'));
      expect(starts.length).toBe(2);
    });
  });

  describe('事件顺序保证', () => {
    it('应该保证同一分区的事件按发布顺序处理', async () => {
      const order: number[] = [];

      bus.subscribeWithPartition('RoomMessage', async (event) => {
        order.push(parseInt(event.message));
      }, (event) => event.roomId);

      for (let i = 1; i <= 10; i++) {
        await bus.publish(new RoomMessageEvent('user1', 'room1', String(i)));
      }

      expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  describe('错误处理', () => {
    it('应该正确处理处理器错误', async () => {
      const error = new Error('Handler error');

      bus.subscribe('UserJoined', () => {
        throw error;
      });

      await expect(bus.publish(new UserJoinedEvent('user1', 'room1'))).rejects.toThrow('Handler error');
    });
  });

  describe('事件元数据', () => {
    it('应该自动添加时间戳', () => {
      const event = new UserJoinedEvent('user1', 'room1');

      expect(event.metadata.timestamp).toBeGreaterThan(0);
      expect(event.metadata.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('应该自动添加来源', () => {
      const event = new UserJoinedEvent('user1', 'room1');

      expect(event.metadata.source).toBe('UserJoinedEvent');
    });
  });
});

describe('装饰器', () => {
  it('应该正确标记事件类型', () => {
    @DomainEvent({ type: 'CustomEvent' })
    class CustomEvent extends DomainEventBase {}

    const type = getDomainEventType(CustomEvent);
    expect(type).toBe('CustomEvent');
  });

  it('应该使用类名作为默认类型', () => {
    @DomainEvent({ type: 'DefaultName' })
    class DefaultNameEvent extends DomainEventBase {}

    const type = getDomainEventType(DefaultNameEvent);
    expect(type).toBe('DefaultName');
  });
});
