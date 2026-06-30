import { describe, it, expect, beforeEach } from 'vitest';
import { RedisSessionStore } from './redis-session-store.js';
import type { SessionData } from '@nbb-ionet/core-framework';
import { createMockRedisClient } from './test-helper.js';

describe('RedisSessionStore', () => {
  let store: RedisSessionStore;
  let mock: ReturnType<typeof createMockRedisClient>;

  beforeEach(() => {
    mock = createMockRedisClient();
    store = new RedisSessionStore(mock.redisClient as never, {
      keyPrefix: 'ionet:session:',
      defaultTtl: 3600,
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize bigint userId', async () => {
      const session: SessionData = {
        userId: BigInt('9007199254740993'),
        createdAt: 1000,
      };

      await store.set('sess1', session);
      const result = await store.get('sess1');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(BigInt('9007199254740993'));
      expect(typeof result!.userId).toBe('bigint');
    });

    it('should serialize Map attributes', async () => {
      const session: SessionData = {
        userId: BigInt(123),
        createdAt: 1000,
        data: {
          items: { foo: 'bar' },
        },
      };

      await store.set('sess2', session);
      const result = await store.get('sess2');

      expect(result).not.toBeNull();
      expect(result!.data?.items).toEqual({ foo: 'bar' });
    });

    it('should handle session without userId', async () => {
      const session: SessionData = { createdAt: 1000 };

      await store.set('sess3', session);
      const result = await store.get('sess3');

      expect(result).not.toBeNull();
      expect(result!.userId).toBeUndefined();
    });

    it('should handle session with expiresAt', async () => {
      const session: SessionData = {
        createdAt: 1000,
        expiresAt: 9999,
      };

      await store.set('sess4', session);
      const result = await store.get('sess4');

      expect(result).not.toBeNull();
      expect(result!.expiresAt).toBe(9999);
    });
  });

  describe('get', () => {
    it('should return null for non-existent session', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should call redis get with prefixed key', async () => {
      const session: SessionData = { createdAt: 1000 };
      await store.set('sess1', session);

      const result = await store.get('sess1');
      expect(result).not.toBeNull();
      expect(mock.client.get).toHaveBeenCalledWith('ionet:session:sess1');
    });
  });

  describe('set', () => {
    it('should use default TTL when not specified', async () => {
      const session: SessionData = { createdAt: 1000 };
      await store.set('sess1', session);

      expect(mock.client.set).toHaveBeenCalledWith(
        'ionet:session:sess1',
        expect.any(String),
        'EX',
        3600,
      );
    });

    it('should use custom TTL when specified', async () => {
      const session: SessionData = { createdAt: 1000 };
      await store.set('sess1', session, 7200);

      expect(mock.client.set).toHaveBeenCalledWith(
        'ionet:session:sess1',
        expect.any(String),
        'EX',
        7200,
      );
    });
  });

  describe('delete', () => {
    it('should delete session by prefixed key', async () => {
      await store.delete('sess1');
      expect(mock.client.del).toHaveBeenCalledWith('ionet:session:sess1');
    });
  });

  describe('cleanup', () => {
    it('should be a no-op (Redis handles TTL)', async () => {
      await expect(store.cleanup()).resolves.toBeUndefined();
    });
  });
});
