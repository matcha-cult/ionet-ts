import type { SessionStore, SessionData } from '@nbb-ionet/core-framework';
import type { RedisClient } from './redis-client.js';

export interface RedisSessionStoreOptions {
  keyPrefix?: string;
  defaultTtl?: number;
}

export class RedisSessionStore implements SessionStore {
  private readonly keyPrefix: string;
  private readonly defaultTtl: number;

  constructor(
    private readonly redisClient: RedisClient,
    options: RedisSessionStoreOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ionet:session:';
    this.defaultTtl = options.defaultTtl ?? 24 * 60 * 60;
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const raw = await this.redisClient.getClient().get(this.key(sessionId));
    if (!raw) return null;
    return this.deserialize(raw);
  }

  async set(sessionId: string, data: SessionData, ttl?: number): Promise<void> {
    const key = this.key(sessionId);
    const value = this.serialize(data);
    const seconds = ttl ?? this.defaultTtl;

    if (seconds > 0) {
      await this.redisClient.getClient().set(key, value, 'EX', seconds);
    } else {
      await this.redisClient.getClient().set(key, value);
    }
  }

  async delete(sessionId: string): Promise<void> {
    await this.redisClient.getClient().del(this.key(sessionId));
  }

  async cleanup(): Promise<void> {
    // Redis handles TTL-based expiration automatically
  }

  private key(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  private serialize(data: SessionData): string {
    return JSON.stringify(data, (_key, value) => {
      if (typeof value === 'bigint') return { __type: 'bigint', value: value.toString() };
      if (value instanceof Map) return { __type: 'map', value: Object.fromEntries(value) };
      return value;
    });
  }

  private deserialize(raw: string): SessionData {
    return JSON.parse(raw, (_key, value) => {
      if (value && typeof value === 'object' && '__type' in value) {
        if (value.__type === 'bigint') return BigInt(value.value as string);
        if (value.__type === 'map') return new Map(Object.entries(value.value as Record<string, unknown>));
      }
      return value;
    }) as SessionData;
  }
}
