import type { RedisClient } from './redis-client.js';
import type { RedisPubSub } from './redis-pub-sub.js';

/** 服务器角色。TS 移植当前只需要「对外服 external」与「逻辑服 logic」两类。 */
export type ServerRole = 'external' | 'logic';

/**
 * RS2 —— 服务器元数据。注册进 Redis 注册表，供外部服/逻辑服做发现与路由。
 * `cmdMerges` 是该逻辑服承接的路由集合（对外服通常为空）。
 */
export interface ServerRecord {
  id: string;
  name: string;
  tag: string;
  serverType: ServerRole;
  ip?: string;
  port?: number;
  cmdMerges: number[];
  startedAt: number;
  lastHeartbeat: number;
  metadata?: Record<string, unknown>;
}

export interface ServerRegistryOptions {
  keyPrefix?: string;
  /** 心跳间隔（毫秒）。 */
  heartbeatIntervalMs?: number;
  /** 超过该时长未心跳视为下线（毫秒）。 */
  heartbeatTimeoutMs?: number;
  /** 本地读缓存 TTL（毫秒）；注册表事件也会立即失效缓存。 */
  cacheTtlMs?: number;
}

export interface ServerRegistryEvent {
  type: 'online' | 'offline';
  id: string;
  name?: string;
  serverType?: ServerRole;
  at: number;
}

export interface ServerDuplicate {
  cmdMerge: number;
  servers: Array<{ id: string; name: string; tag: string }>;
}

/**
 * RS2 —— Redis 服务器注册表 / 发现。
 *
 * 键布局：
 * - `{prefix}servers` hash：serverId → ServerRecord(JSON)
 * - `{prefix}servers:events` pub/sub：上线/下线事件（缓存失效 + 订阅方感知）
 *
 * 同一 cmdMerge 只允许一个 owner（与 Java DefaultLogicServerLoadBalanced 一致，
 * 不做轮询）；重复注册由 `detectDuplicates()` 显式报告（RS8）。
 */
export class ServerRegistry {
  private readonly keyPrefix: string;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly cacheTtlMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private watcherStarted = false;
  private selfRecord: ServerRecord | null = null;
  private cache: { at: number; servers: ServerRecord[] } | null = null;

  constructor(
    private readonly redisClient: RedisClient,
    private readonly pubSub: RedisPubSub,
    options: ServerRegistryOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ionet:';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 15000;
    this.cacheTtlMs = options.cacheTtlMs ?? 250;
  }

  getKeyPrefix(): string {
    return this.keyPrefix;
  }

  getHeartbeatTimeoutMs(): number {
    return this.heartbeatTimeoutMs;
  }

  /** 订阅注册表事件并开始本地读缓存。幂等。 */
  async start(): Promise<void> {
    if (this.watcherStarted) return;
    await this.pubSub.subscribe(this.eventChannel(), () => {
      this.invalidate();
    });
    this.watcherStarted = true;
  }

  /**
   * 注册本实例并开始心跳。返回写入注册表的完整记录（补全 lastHeartbeat）。
   */
  async register(
    record: Omit<ServerRecord, 'lastHeartbeat'> & { lastHeartbeat?: number },
  ): Promise<ServerRecord> {
    const now = Date.now();
    const full: ServerRecord = { ...record, lastHeartbeat: record.lastHeartbeat ?? now };
    this.selfRecord = full;
    await this.write(full);
    await this.publishEvent({ type: 'online', id: full.id, name: full.name, serverType: full.serverType, at: now });
    this.startHeartbeat();
    return full;
  }

  /** 注销本实例（或指定实例 id）并停止心跳。 */
  async unregister(instanceId?: string): Promise<void> {
    const id = instanceId ?? this.selfRecord?.id;
    this.stopHeartbeat();
    if (!id) return;
    await this.redisClient.getClient().hdel(this.serversKey(), id);
    this.invalidate();
    await this.publishEvent({ type: 'offline', id, at: Date.now() });
  }

  async unregisterSelf(): Promise<void> {
    const id = this.selfRecord?.id;
    this.selfRecord = null;
    await this.unregister(id);
  }

  async stop(): Promise<void> {
    await this.unregisterSelf();
    if (this.watcherStarted) {
      await this.pubSub.unsubscribe(this.eventChannel());
      this.watcherStarted = false;
    }
  }

  /** 立即写一次心跳（测试与优雅下线前的显式刷新用）。 */
  async heartbeat(): Promise<void> {
    if (!this.selfRecord) return;
    this.selfRecord = { ...this.selfRecord, lastHeartbeat: Date.now() };
    await this.write(this.selfRecord);
    this.invalidate();
  }

  async listAlive(): Promise<ServerRecord[]> {
    if (this.cache && Date.now() - this.cache.at < this.cacheTtlMs) {
      return this.cache.servers;
    }
    const all = await this.redisClient.getClient().hgetall(this.serversKey());
    const now = Date.now();
    const servers = Object.values(all)
      .map((raw) => this.parse(raw))
      .filter((record): record is ServerRecord => record !== null)
      .filter((record) => now - record.lastHeartbeat < this.heartbeatTimeoutMs)
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    this.cache = { at: now, servers };
    return servers;
  }

  async listByRole(role: ServerRole): Promise<ServerRecord[]> {
    return (await this.listAlive()).filter((record) => record.serverType === role);
  }

  async getServer(id: string): Promise<ServerRecord | null> {
    const record = this.parse(await this.redisClient.getClient().hget(this.serversKey(), id));
    return record;
  }

  async isAlive(id: string): Promise<boolean> {
    const record = await this.getServer(id);
    if (!record) return false;
    return Date.now() - record.lastHeartbeat < this.heartbeatTimeoutMs;
  }

  /**
   * 按 cmdMerge 解析逻辑服 owner。
   *
   * 与 Java `DefaultLogicServerLoadBalanced` 对齐：同一 cmdMerge 只认一个 owner——
   * 取最近注册（startedAt 最大）的存活逻辑服，不做轮询。重复注册由 RS8 检测报告。
   */
  async findServerByCmdMerge(cmdMerge: number): Promise<ServerRecord | null> {
    const candidates = (await this.listAlive()).filter(
      (record) => record.serverType === 'logic' && record.cmdMerges.includes(cmdMerge),
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, record) =>
      record.startedAt > latest.startedAt ||
      (record.startedAt === latest.startedAt && record.id > latest.id)
        ? record
        : latest,
    );
  }

  /** 按 tag 找存活逻辑服（应用级 affinity / 同类型多实例定向）。 */
  async findServersByTag(tag: string): Promise<ServerRecord[]> {
    return (await this.listAlive()).filter(
      (record) => record.serverType === 'logic' && record.tag === tag,
    );
  }

  /** 轮询等待某 cmdMerge 出现 owner（多进程测试 / 启动期等待注册用）。 */
  async waitForServerByCmdMerge(cmdMerge: number, timeoutMs = 5000): Promise<ServerRecord | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const record = await this.findServerByCmdMerge(cmdMerge);
      if (record) return record;
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** RS8：注册表中跨进程重复承接同一 cmdMerge 的逻辑服。 */
  async detectDuplicates(): Promise<ServerDuplicate[]> {
    const byMerge = new Map<number, Array<{ id: string; name: string; tag: string }>>();
    for (const record of await this.listAlive()) {
      for (const cmdMerge of record.cmdMerges) {
        if (!byMerge.has(cmdMerge)) byMerge.set(cmdMerge, []);
        byMerge.get(cmdMerge)!.push({ id: record.id, name: record.name, tag: record.tag });
      }
    }
    const duplicates: ServerDuplicate[] = [];
    for (const [cmdMerge, servers] of byMerge) {
      if (servers.length > 1) {
        duplicates.push({ cmdMerge, servers });
      }
    }
    return duplicates;
  }

  invalidate(): void {
    this.cache = null;
  }

  private async write(record: ServerRecord): Promise<void> {
    await this.redisClient
      .getClient()
      .hset(this.serversKey(), record.id, JSON.stringify(record));
    this.invalidate();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat().catch(() => {
        /* heartbeat failure is non-fatal */
      });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private parse(raw: string | null | undefined): ServerRecord | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ServerRecord;
    } catch {
      return null;
    }
  }

  private async publishEvent(event: ServerRegistryEvent): Promise<void> {
    await this.pubSub.publish(this.eventChannel(), event);
  }

  private serversKey(): string {
    return `${this.keyPrefix}servers`;
  }

  private eventChannel(): string {
    return `${this.keyPrefix}servers:events`;
  }
}
