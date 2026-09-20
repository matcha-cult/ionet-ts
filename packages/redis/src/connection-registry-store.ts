import type { RedisClient } from './redis-client.js';

export interface ConnectionRegistryStoreOptions {
  keyPrefix?: string;
}

/**
 * RS6 —— 跨进程「某 userId 连在哪个对外服实例」的连接注册表。
 *
 * 键布局：
 * - `{prefix}user-instance` hash：userId → instanceId（全局查询用）
 * - `{prefix}instance-users:{instanceId}` set：该实例当前持有的 userId（实例级清理用）
 *
 * 存活判定不在此处：实例下线由 `ServerRegistry.isAlive(instanceId)` 提供，
 * 使「连接记录仍在但实例已宕机」可被显式识别（宕机不静默丢帧）。
 */
export class ConnectionRegistryStore {
  private readonly keyPrefix: string;

  constructor(
    private readonly redisClient: RedisClient,
    options: ConnectionRegistryStoreOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ionet:';
  }

  async bind(userId: string, instanceId: string): Promise<void> {
    const client = this.redisClient.getClient();
    await client.hset(this.userInstanceKey(), userId, instanceId);
    await client.sadd(this.instanceUsersKey(instanceId), userId);
  }

  async unbind(userId: string): Promise<void> {
    const client = this.redisClient.getClient();
    const instanceId = await client.hget(this.userInstanceKey(), userId);
    await client.hdel(this.userInstanceKey(), userId);
    if (instanceId) {
      await client.srem(this.instanceUsersKey(instanceId), userId);
    }
  }

  /** 实例下线时清空其全部连接登记（连接已随进程消失）。 */
  async unbindInstance(instanceId: string): Promise<void> {
    const client = this.redisClient.getClient();
    const users = await client.smembers(this.instanceUsersKey(instanceId));
    for (const userId of users) {
      await client.hdel(this.userInstanceKey(), userId);
    }
    await client.del(this.instanceUsersKey(instanceId));
  }

  async lookup(userId: string): Promise<string | null> {
    return this.redisClient.getClient().hget(this.userInstanceKey(), userId);
  }

  async listUsers(instanceId: string): Promise<string[]> {
    return this.redisClient.getClient().smembers(this.instanceUsersKey(instanceId));
  }

  async count(instanceId: string): Promise<number> {
    return this.redisClient.getClient().scard(this.instanceUsersKey(instanceId));
  }

  private userInstanceKey(): string {
    return `${this.keyPrefix}user-instance`;
  }

  private instanceUsersKey(instanceId: string): string {
    return `${this.keyPrefix}instance-users:${instanceId}`;
  }
}
