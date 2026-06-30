import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RedisPubSub } from './redis-pub-sub.js';
import { IPC_CHANNELS, type IpcMessage } from './redis-types.js';
import { createMockRedisClient } from './test-helper.js';

describe('RedisPubSub', () => {
  let pubSub: RedisPubSub;
  let mock: ReturnType<typeof createMockRedisClient>;

  beforeEach(async () => {
    mock = createMockRedisClient('instance-1');
    pubSub = new RedisPubSub(mock.redisClient as never);
    await pubSub.connect();
  });

  afterEach(async () => {
    await pubSub.disconnect();
  });

  describe('connect', () => {
    it('should register message event listeners on subscriber', () => {
      expect(mock.subscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mock.subscriber.on).toHaveBeenCalledWith('pmessage', expect.any(Function));
    });
  });

  describe('subscribe', () => {
    it('should subscribe to prefixed channel on first handler', async () => {
      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, () => {});
      expect(mock.subscriber.subscribe).toHaveBeenCalledWith('ionet:broadcast');
    });

    it('should not re-subscribe for second handler on same channel', async () => {
      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, () => {});
      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, () => {});
      expect(mock.subscriber.subscribe).toHaveBeenCalledTimes(1);
    });

    it('should subscribe with keyPrefix', async () => {
      const prefixed = new RedisPubSub(mock.redisClient as never, { keyPrefix: 'myapp:' });
      await prefixed.connect();
      await prefixed.subscribe(IPC_CHANNELS.BROADCAST, () => {});
      expect(mock.subscriber.subscribe).toHaveBeenCalledWith('myapp:ionet:broadcast');
      await prefixed.disconnect();
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe when all handlers removed', async () => {
      const handler = () => {};
      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, handler);
      await pubSub.unsubscribe(IPC_CHANNELS.BROADCAST, handler);
      expect(mock.subscriber.unsubscribe).toHaveBeenCalledWith('ionet:broadcast');
    });

    it('should not unsubscribe if other handlers remain', async () => {
      const handler1 = () => {};
      const handler2 = () => {};
      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, handler1);
      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, handler2);

      await pubSub.unsubscribe(IPC_CHANNELS.BROADCAST, handler1);
      expect(mock.subscriber.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('should publish message with IPC envelope', async () => {
      await pubSub.publish(IPC_CHANNELS.BROADCAST, { data: 'hello' });

      expect(mock.client.publish).toHaveBeenCalledTimes(1);
      const [channel, raw] = mock.published[0];
      expect(channel).toBe('ionet:broadcast');

      const msg: IpcMessage = JSON.parse(raw);
      expect(msg.sourceInstanceId).toBe('instance-1');
      expect(msg.type).toBe(IPC_CHANNELS.BROADCAST);
      expect(msg.payload).toEqual({ data: 'hello' });
      expect(msg.timestamp).toBeGreaterThan(0);
    });
  });

  describe('message delivery', () => {
    it('should deliver messages to subscribed handlers', async () => {
      const received: IpcMessage[] = [];
      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, (_ch, msg) => {
        received.push(msg);
      });

      const envelope: IpcMessage = {
        sourceInstanceId: 'instance-2',
        type: IPC_CHANNELS.BROADCAST,
        payload: { data: 'test' },
        timestamp: Date.now(),
      };

      mock.pubSubEmitter.emit('message', 'ionet:broadcast', JSON.stringify(envelope));

      expect(received).toHaveLength(1);
      expect(received[0].payload).toEqual({ data: 'test' });
      expect(received[0].sourceInstanceId).toBe('instance-2');
    });

    it('should not deliver messages to unsubscribed handlers', async () => {
      const received: IpcMessage[] = [];
      const handler = (_ch: string, msg: IpcMessage) => received.push(msg);

      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, handler);
      await pubSub.unsubscribe(IPC_CHANNELS.BROADCAST, handler);

      const envelope: IpcMessage = {
        sourceInstanceId: 'instance-2',
        type: IPC_CHANNELS.BROADCAST,
        payload: { data: 'test' },
        timestamp: Date.now(),
      };

      mock.pubSubEmitter.emit('message', 'ionet:broadcast', JSON.stringify(envelope));
      expect(received).toHaveLength(0);
    });

    it('should ignore malformed JSON messages', async () => {
      const received: IpcMessage[] = [];
      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, (_ch, msg) => received.push(msg));

      mock.pubSubEmitter.emit('message', 'ionet:broadcast', 'not-json{{{');
      expect(received).toHaveLength(0);
    });

    it('should only deliver to handlers of matching channel', async () => {
      const broadcastReceived: IpcMessage[] = [];
      const userReceived: IpcMessage[] = [];

      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, (_ch, msg) => broadcastReceived.push(msg));
      await pubSub.subscribe(IPC_CHANNELS.USER_MESSAGE, (_ch, msg) => userReceived.push(msg));

      const envelope: IpcMessage = {
        sourceInstanceId: 'instance-2',
        type: IPC_CHANNELS.BROADCAST,
        payload: { data: 'test' },
        timestamp: Date.now(),
      };

      mock.pubSubEmitter.emit('message', 'ionet:broadcast', JSON.stringify(envelope));

      expect(broadcastReceived).toHaveLength(1);
      expect(userReceived).toHaveLength(0);
    });
  });

  describe('pattern subscribe', () => {
    it('should psubscribe with prefixed pattern', async () => {
      await pubSub.psubscribe('ionet:room:*', () => {});
      expect(mock.subscriber.psubscribe).toHaveBeenCalledWith('ionet:room:*');
    });

    it('should deliver pattern-matched messages', async () => {
      const received: Array<{ channel: string; msg: IpcMessage }> = [];
      await pubSub.psubscribe('ionet:room:*', (channel, msg) => {
        received.push({ channel, msg });
      });

      const envelope: IpcMessage = {
        sourceInstanceId: 'instance-2',
        type: 'room-msg',
        payload: { roomId: 'r1' },
        timestamp: Date.now(),
      };

      mock.pubSubEmitter.emit('pmessage', 'ionet:room:*', 'ionet:room:r1', JSON.stringify(envelope));

      expect(received).toHaveLength(1);
      expect(received[0].channel).toBe('ionet:room:r1');
    });
  });

  describe('disconnect', () => {
    it('should unsubscribe and punsubscribe', async () => {
      await pubSub.subscribe(IPC_CHANNELS.BROADCAST, () => {});
      await pubSub.disconnect();
      expect(mock.subscriber.unsubscribe).toHaveBeenCalled();
      expect(mock.subscriber.punsubscribe).toHaveBeenCalled();
    });
  });
});
