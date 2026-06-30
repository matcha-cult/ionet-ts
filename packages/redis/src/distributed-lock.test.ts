import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DistributedLock } from './distributed-lock.js';
import { createMockRedisClient } from './test-helper.js';

describe('DistributedLock', () => {
  let lock: DistributedLock;
  let mock: ReturnType<typeof createMockRedisClient>;

  beforeEach(() => {
    mock = createMockRedisClient('instance-1');
    lock = new DistributedLock(mock.redisClient as never, {
      keyPrefix: 'ionet:lock:',
      defaultTtlMs: 30_000,
      watchdogIntervalMs: 100,
    });
  });

  afterEach(async () => {
    await lock.shutdown();
  });

  describe('acquire', () => {
    it('should set key with NX PX flags', async () => {
      const result = await lock.acquire('my-lock');
      expect(result).toBe(true);
      expect(mock.client.set).toHaveBeenCalledWith(
        'ionet:lock:my-lock',
        expect.any(String),
        'PX',
        30_000,
        'NX',
      );
    });

    it('should use custom TTL', async () => {
      await lock.acquire('my-lock', 5000);
      expect(mock.client.set).toHaveBeenCalledWith(
        'ionet:lock:my-lock',
        expect.any(String),
        'PX',
        5000,
        'NX',
      );
    });
  });

  describe('release', () => {
    it('should call eval with unlock Lua script', async () => {
      await lock.acquire('my-lock');
      const result = await lock.release('my-lock');

      expect(result).toBe(true);
      expect(mock.client.eval).toHaveBeenCalledWith(
        expect.stringContaining('get'),
        1,
        'ionet:lock:my-lock',
        expect.any(String),
      );
    });
  });

  describe('isLocked', () => {
    it('should return false for unlocked key', async () => {
      const result = await lock.isLocked('my-lock');
      expect(result).toBe(false);
    });

    it('should return true for locked key', async () => {
      await lock.acquire('my-lock');
      const result = await lock.isLocked('my-lock');
      expect(result).toBe(true);
    });
  });

  describe('renew', () => {
    it('should call eval with renew Lua script', async () => {
      await lock.acquire('my-lock');
      const result = await lock.renew('my-lock', 60_000);

      expect(result).toBe(true);
      expect(mock.client.eval).toHaveBeenCalledWith(
        expect.stringContaining('pexpire'),
        1,
        'ionet:lock:my-lock',
        expect.any(String),
        '60000',
      );
    });
  });

  describe('watchdog', () => {
    it('should periodically renew the lock', async () => {
      await lock.acquire('my-lock');
      lock.startWatchdog('my-lock');

      await new Promise(resolve => setTimeout(resolve, 350));

      expect(mock.client.eval).toHaveBeenCalled();

      await lock.shutdown();
    });

    it('should stop renewal after stopWatchdog', async () => {
      await lock.acquire('my-lock');
      lock.startWatchdog('my-lock');
      lock.stopWatchdog('my-lock');

      const callCount = mock.client.eval.mock.calls.length;
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(mock.client.eval.mock.calls.length).toBe(callCount);
    });
  });

  describe('shutdown', () => {
    it('should clear all watchdogs', async () => {
      await lock.acquire('lock1');
      await lock.acquire('lock2');
      lock.startWatchdog('lock1');
      lock.startWatchdog('lock2');

      await lock.shutdown();

      const evalCalls = mock.client.eval.mock.calls.length;
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(mock.client.eval.mock.calls.length).toBe(evalCalls);
    });
  });
});
