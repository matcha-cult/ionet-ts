import { randomUUID } from 'node:crypto';
import {
  type Broadcaster,
  type BroadcastMessage,
  type ConnectionRegistry,
  type RoomRegistry,
} from '@nbb-ionet/core-framework';
import type { RedisPubSub } from './redis-pub-sub.js';

const BROADCAST_CHANNELS = {
  ALL: 'broadcast:all',
  USER: 'broadcast:user',
  USERS: 'broadcast:users',
  ROOM: 'broadcast:room',
} as const;

interface Envelope<T> {
  instanceId: string;
  payload: T;
}

/**
 * RS6：userId → 对外服实例 的连接归属查询（由 `ConnectionRegistryStore` 提供）。
 * 只需 lookup，避免 redis 包反向依赖逻辑服包。
 */
export interface ConnectionOwnerStore {
  lookup(userId: string): Promise<string | null>;
}

/** 连接归属未知：userId 无任何在线连接登记。 */
export class ConnectionOwnerUnknownError extends Error {
  readonly code = 'CONNECTION_OWNER_UNKNOWN';
  constructor(readonly userId: string) {
    super(`No external server instance holds a connection for userId=${userId}`);
    this.name = 'ConnectionOwnerUnknownError';
  }
}

/** 连接归属实例已下线：登记仍在但实例心跳已过期（宕机不静默丢帧）。 */
export class ConnectionOwnerOfflineError extends Error {
  readonly code = 'CONNECTION_OWNER_OFFLINE';
  constructor(readonly userId: string, readonly instanceId: string) {
    super(
      `External server instance ${instanceId} holding userId=${userId} is offline; message was not delivered`,
    );
    this.name = 'ConnectionOwnerOfflineError';
  }
}

export interface DistributedBroadcasterDecoratorOptions {
  instanceId?: string;
  /**
   * 跨进程连接归属表。给出后 `broadcastToUser` 走**定向通道**：
   * 先查归属实例，实例不在线时显式抛 `ConnectionOwnerOfflineError`（不静默丢帧）。
   * 未给出时保持既有行为（全局 USER 通道 + 各实例本地过滤）。
   */
  connectionStore?: ConnectionOwnerStore;
  /** 实例存活判定；缺省视为存活（只做归属判断，不判活）。 */
  isInstanceAlive?: (instanceId: string) => Promise<boolean>;
}

export class DistributedBroadcasterDecorator implements Broadcaster {
  private subscribed = false;
  private readonly instanceId: string;

  constructor(
    private readonly local: Broadcaster,
    private readonly pubSub: RedisPubSub,
    private readonly connections: ConnectionRegistry,
    private readonly rooms: RoomRegistry,
    options: DistributedBroadcasterDecoratorOptions = {},
  ) {
    this.instanceId = options.instanceId ?? pubSub.getInstanceId() ?? randomUUID();
    this.connectionStore = options.connectionStore ?? null;
    this.isInstanceAlive = options.isInstanceAlive ?? null;
  }

  private readonly connectionStore: ConnectionOwnerStore | null;
  private readonly isInstanceAlive: ((instanceId: string) => Promise<boolean>) | null;

  getInstanceId(): string {
    return this.instanceId;
  }

  /** 本实例的定向用户推送通道（其它实例按连接归属表定位到本通道）。 */
  getUserTargetChannel(): string {
    return `${BROADCAST_CHANNELS.USER}:${this.instanceId}`;
  }

  async start(): Promise<void> {
    if (this.subscribed) return;

    await this.pubSub.subscribe(BROADCAST_CHANNELS.ALL, (_ch, msg) => {
      const { instanceId, payload } = msg.payload as Envelope<BroadcastMessage>;
      if (instanceId === this.instanceId) return;
      void this.local.broadcastToAll(payload);
    });

    await this.pubSub.subscribe(BROADCAST_CHANNELS.USER, (_ch, msg) => {
      const { instanceId, payload } = msg.payload as Envelope<{ userId: string; message: BroadcastMessage }>;
      if (instanceId === this.instanceId) return;
      void this.local.broadcastToUser(payload.userId, payload.message);
    });

    // RS6 定向通道：发送方已按连接归属表定位到本实例，收到即本地投递（不再按 instanceId 过滤）。
    await this.pubSub.subscribe(this.getUserTargetChannel(), (_ch, msg) => {
      const { payload } = msg.payload as Envelope<{ userId: string; message: BroadcastMessage }>;
      void this.local.broadcastToUser(payload.userId, payload.message);
    });

    await this.pubSub.subscribe(BROADCAST_CHANNELS.USERS, (_ch, msg) => {
      const { instanceId, payload } = msg.payload as Envelope<{ userIds: string[]; message: BroadcastMessage }>;
      if (instanceId === this.instanceId) return;
      void this.local.broadcastToUsers(payload.userIds, payload.message);
    });

    await this.pubSub.subscribe(BROADCAST_CHANNELS.ROOM, (_ch, msg) => {
      const { instanceId, payload } = msg.payload as Envelope<{
        roomId: string;
        message: BroadcastMessage;
        excludeUserId?: string;
      }>;
      if (instanceId === this.instanceId) return;
      void this.local.broadcastToRoom(payload.roomId, payload.message, payload.excludeUserId);
    });

    this.subscribed = true;
  }

  async stop(): Promise<void> {
    if (!this.subscribed) return;

    await this.pubSub.unsubscribe(BROADCAST_CHANNELS.ALL);
    await this.pubSub.unsubscribe(BROADCAST_CHANNELS.USER);
    await this.pubSub.unsubscribe(this.getUserTargetChannel());
    await this.pubSub.unsubscribe(BROADCAST_CHANNELS.USERS);
    await this.pubSub.unsubscribe(BROADCAST_CHANNELS.ROOM);

    this.subscribed = false;
  }

  async broadcastToAll(message: BroadcastMessage): Promise<void> {
    await this.local.broadcastToAll(message);
    await this.pubSub.publish(BROADCAST_CHANNELS.ALL, this.wrap(message));
  }

  /**
   * 定向推送。连接在本实例 → 本地投递；否则按连接归属表走定向通道。
   * 归属未知 / 归属实例离线 → 显式抛错（RS6 验收：实例宕机不静默丢帧）。
   */
  async broadcastToUser(userId: string, message: BroadcastMessage): Promise<void> {
    if (this.connections.isLocalUser(userId)) {
      await this.local.broadcastToUser(userId, message);
      return;
    }

    if (!this.connectionStore) {
      await this.pubSub.publish(BROADCAST_CHANNELS.USER, this.wrap({ userId, message }));
      return;
    }

    const owner = await this.connectionStore.lookup(userId);
    if (!owner) {
      throw new ConnectionOwnerUnknownError(userId);
    }
    if (this.isInstanceAlive && !(await this.isInstanceAlive(owner))) {
      throw new ConnectionOwnerOfflineError(userId, owner);
    }
    if (owner === this.instanceId) {
      await this.local.broadcastToUser(userId, message);
      return;
    }
    await this.pubSub.publish(`${BROADCAST_CHANNELS.USER}:${owner}`, this.wrap({ userId, message }));
  }

  async broadcastToUsers(userIds: string[], message: BroadcastMessage): Promise<void> {
    const localUserIds = userIds.filter((id) => this.connections.isLocalUser(id));
    if (localUserIds.length > 0) {
      await this.local.broadcastToUsers(localUserIds, message);
    }
    await this.pubSub.publish(BROADCAST_CHANNELS.USERS, this.wrap({ userIds, message }));
  }

  async broadcastToRoom(roomId: string, message: BroadcastMessage, excludeUserId?: string): Promise<void> {
    await this.local.broadcastToRoom(roomId, message, excludeUserId);
    await this.pubSub.publish(BROADCAST_CHANNELS.ROOM, this.wrap({ roomId, message, excludeUserId }));
  }

  private wrap<T>(payload: T): Envelope<T> {
    return { instanceId: this.instanceId, payload };
  }
}
