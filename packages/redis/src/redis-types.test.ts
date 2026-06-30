import { describe, it, expect, beforeEach } from 'vitest';
import { createIpcMessage, IPC_CHANNELS } from './redis-types.js';

describe('redis-types', () => {
  describe('IPC_CHANNELS', () => {
    it('should define all channel names', () => {
      expect(IPC_CHANNELS.BROADCAST).toBe('ionet:broadcast');
      expect(IPC_CHANNELS.USER_MESSAGE).toBe('ionet:user');
      expect(IPC_CHANNELS.ROOM_MESSAGE).toBe('ionet:room');
      expect(IPC_CHANNELS.ROOM_EVENT).toBe('ionet:room:event');
      expect(IPC_CHANNELS.INSTANCE_EVENT).toBe('ionet:instance');
    });
  });

  describe('createIpcMessage', () => {
    it('should create message with all required fields', () => {
      const msg = createIpcMessage('instance-1', 'test-channel', { data: 'hello' });

      expect(msg.sourceInstanceId).toBe('instance-1');
      expect(msg.type).toBe('test-channel');
      expect(msg.payload).toEqual({ data: 'hello' });
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('should use current timestamp', () => {
      const before = Date.now();
      const msg = createIpcMessage('instance-1', 'test', null);
      const after = Date.now();

      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it('should handle null payload', () => {
      const msg = createIpcMessage('instance-1', 'test', null);
      expect(msg.payload).toBeNull();
    });

    it('should handle complex payload', () => {
      const payload = {
        users: [1, 2, 3],
        nested: { deep: { value: true } },
        items: new Map([['key', 'value']]),
      };

      const msg = createIpcMessage('instance-1', 'test', payload);
      expect(msg.payload).toEqual(payload);
    });
  });
});
