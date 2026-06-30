import { randomUUID } from 'node:crypto';
import type { RedisClient } from './redis-client.js';

export interface InstanceManagerOptions {
  keyPrefix?: string;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface InstanceInfo {
  instanceId: string;
  lastHeartbeat: number;
  startedAt: number;
  metadata: Record<string, unknown>;
}

export class InstanceManager {
  private readonly instanceId: string;
  private readonly keyPrefix: string;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly metadata: Record<string, unknown>;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly redisClient: RedisClient,
    options: InstanceManagerOptions = {},
  ) {
    this.instanceId = redisClient.getInstanceId();
    this.keyPrefix = options.keyPrefix ?? 'ionet:';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 30_000;
    this.metadata = options.metadata ?? {};
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  async register(): Promise<void> {
    const now = Date.now();
    const data: InstanceInfo = {
      instanceId: this.instanceId,
      lastHeartbeat: now,
      startedAt: now,
      metadata: this.metadata,
    };

    await this.redisClient
      .getClient()
      .hset(this.instancesKey(), this.instanceId, JSON.stringify(data));

    this.startHeartbeat();
  }

  async unregister(): Promise<void> {
    this.stopHeartbeat();
    await this.redisClient.getClient().hdel(this.instancesKey(), this.instanceId);
    await this.redisClient
      .getClient()
      .del(`${this.keyPrefix}user-instance:${this.instanceId}`);
  }

  async getInstances(): Promise<InstanceInfo[]> {
    const all = await this.redisClient.getClient().hgetall(this.instancesKey());
    const now = Date.now();

    return Object.values(all)
      .map(raw => JSON.parse(raw) as InstanceInfo)
      .filter(info => now - info.lastHeartbeat < this.heartbeatTimeoutMs);
  }

  async isInstanceAlive(instanceId: string): Promise<boolean> {
    const raw = await this.redisClient.getClient().hget(this.instancesKey(), instanceId);
    if (!raw) return false;
    const info = JSON.parse(raw) as InstanceInfo;
    return Date.now() - info.lastHeartbeat < this.heartbeatTimeoutMs;
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      try {
        const data: InstanceInfo = {
          instanceId: this.instanceId,
          lastHeartbeat: Date.now(),
          startedAt: Date.now(),
          metadata: this.metadata,
        };
        await this.redisClient
          .getClient()
          .hset(this.instancesKey(), this.instanceId, JSON.stringify(data));
      } catch { /* heartbeat failure is non-fatal */ }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private instancesKey(): string {
    return `${this.keyPrefix}instances`;
  }
}
