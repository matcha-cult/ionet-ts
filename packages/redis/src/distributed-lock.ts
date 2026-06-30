import type { Redis } from 'ioredis';
import type { RedisClient } from './redis-client.js';

export interface DistributedLockOptions {
  keyPrefix?: string;
  defaultTtlMs?: number;
  retryIntervalMs?: number;
  retryTimeoutMs?: number;
  watchdogIntervalMs?: number;
}

export class DistributedLock {
  private readonly keyPrefix: string;
  private readonly defaultTtlMs: number;
  private readonly retryIntervalMs: number;
  private readonly retryTimeoutMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly lockValue: string;
  private readonly watchdogs = new Map<string, ReturnType<typeof setInterval>>();

  private static readonly UNLOCK_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  private static readonly RENEW_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  constructor(
    private readonly redisClient: RedisClient,
    options: DistributedLockOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ionet:lock:';
    this.defaultTtlMs = options.defaultTtlMs ?? 30_000;
    this.retryIntervalMs = options.retryIntervalMs ?? 100;
    this.retryTimeoutMs = options.retryTimeoutMs ?? 10_000;
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? 10_000;
    this.lockValue = `${this.redisClient.getInstanceId()}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }

  async acquire(key: string, ttlMs?: number): Promise<boolean> {
    const lockKey = this.key(key);
    const ttl = ttlMs ?? this.defaultTtlMs;
    const result = await this.redisClient
      .getClient()
      .set(lockKey, this.lockValue, 'PX', ttl, 'NX');
    return result === 'OK';
  }

  async acquireWithRetry(key: string, ttlMs?: number): Promise<boolean> {
    const deadline = Date.now() + this.retryTimeoutMs;

    while (Date.now() < deadline) {
      if (await this.acquire(key, ttlMs)) return true;
      await this.delay(this.retryIntervalMs);
    }

    return false;
  }

  async release(key: string): Promise<boolean> {
    const lockKey = this.key(key);
    this.stopWatchdog(key);
    const client = this.redisClient.getClient();
    const result = await client.eval(DistributedLock.UNLOCK_SCRIPT, 1, lockKey, this.lockValue);
    return result === 1;
  }

  async renew(key: string, ttlMs?: number): Promise<boolean> {
    const lockKey = this.key(key);
    const ttl = ttlMs ?? this.defaultTtlMs;
    const client = this.redisClient.getClient();
    const result = await client.eval(DistributedLock.RENEW_SCRIPT, 1, lockKey, this.lockValue, String(ttl));
    return result === 1;
  }

  startWatchdog(key: string, ttlMs?: number): void {
    this.stopWatchdog(key);
    const ttl = ttlMs ?? this.defaultTtlMs;

    const timer = setInterval(async () => {
      try {
        await this.renew(key, ttl);
      } catch { /* watchdog failures are non-fatal */ }
    }, this.watchdogIntervalMs);

    this.watchdogs.set(key, timer);
  }

  stopWatchdog(key: string): void {
    const timer = this.watchdogs.get(key);
    if (timer) {
      clearInterval(timer);
      this.watchdogs.delete(key);
    }
  }

  async isLocked(key: string): Promise<boolean> {
    const value = await this.redisClient.getClient().get(this.key(key));
    return value !== null;
  }

  async shutdown(): Promise<void> {
    for (const timer of this.watchdogs.values()) {
      clearInterval(timer);
    }
    this.watchdogs.clear();
  }

  private key(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
