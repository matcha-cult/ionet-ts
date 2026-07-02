import type { RedisClient } from './redis-client.js';
import type { RedisPubSub } from './redis-pub-sub.js';
import { IPC_CHANNELS } from './redis-types.js';

export interface RoomMetadata {
  name?: string;
  maxMembers?: number;
  password?: string;
  [key: string]: unknown;
}

export type RoomRole = 'owner' | 'admin' | 'member';

export interface RoomMemberInfo {
  userId: string;
  role: RoomRole;
  joinedAt: number;
}

export interface RoomMessageOptions {
  excludeUserId?: string;
  messageType?: string;
}

export interface RoomSearchOptions {
  namePattern?: string;
  minMembers?: number;
  maxMembers?: number;
  hasPassword?: boolean;
  limit?: number;
  offset?: number;
}

export type RoomMessageHandler = (roomId: string, data: unknown, senderId?: string, messageType?: string) => void;
export type RoomEventHandler = (
  roomId: string,
  event: 'create' | 'destroy' | 'join' | 'leave' | 'update',
  userId: string,
  metadata?: RoomMetadata,
) => void;

export interface DistributedRoomOptions {
  keyPrefix?: string;
  maxHistorySize?: number;
}

export class DistributedRoomExtended {
  private readonly keyPrefix: string;
  private readonly maxHistorySize: number;
  private readonly localMembers = new Map<string, Set<string>>();
  private readonly memberRoles = new Map<string, Map<string, RoomRole>>();
  private readonly messageHandlers = new Set<RoomMessageHandler>();
  private readonly eventHandlers = new Set<RoomEventHandler>();
  private started = false;

  constructor(
    private readonly redisClient: RedisClient,
    private readonly pubSub: RedisPubSub,
    options: DistributedRoomOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ionet:';
    this.maxHistorySize = options.maxHistorySize ?? 100;
  }

  async start(): Promise<void> {
    if (this.started) return;

    await this.pubSub.subscribe(IPC_CHANNELS.ROOM_MESSAGE, (_ch, msg) => {
      const payload = msg.payload as {
        roomId: string;
        data: unknown;
        senderId?: string;
        messageType?: string;
      };
      this.handleLocalMessage(payload.roomId, payload.data, payload.senderId, payload.messageType);
    });

    await this.pubSub.subscribe(IPC_CHANNELS.ROOM_EVENT, (_ch, msg) => {
      const payload = msg.payload as {
        roomId: string;
        userId: string;
        event: 'create' | 'destroy' | 'join' | 'leave' | 'update';
        metadata?: RoomMetadata;
      };
      this.handleRemoteEvent(payload.roomId, payload.event, payload.userId, payload.metadata);
    });

    this.started = true;
  }

  async createRoom(roomId: string, ownerId: string, metadata: RoomMetadata = {}): Promise<void> {
    const key = this.roomKey(roomId);
    const client = this.redisClient.getClient();

    await client.hset(key, 'metadata', JSON.stringify(metadata));
    await client.hset(key, 'createdAt', String(Date.now()));
    await client.hset(key, 'ownerId', ownerId);

    const membersKey = this.membersKey(roomId);
    await client.sadd(membersKey, ownerId);

    let local = this.localMembers.get(roomId);
    if (!local) {
      local = new Set();
      this.localMembers.set(roomId, local);
    }
    local.add(ownerId);

    let roles = this.memberRoles.get(roomId);
    if (!roles) {
      roles = new Map();
      this.memberRoles.set(roomId, roles);
    }
    roles.set(ownerId, 'owner');

    await client.hset(this.rolesKey(roomId), ownerId, 'owner');

    await this.pubSub.publish(IPC_CHANNELS.ROOM_EVENT, {
      roomId,
      userId: ownerId,
      event: 'create',
      metadata,
    });
  }

  async destroyRoom(roomId: string, userId: string): Promise<boolean> {
    const ownerId = await this.redisClient.getClient().hget(this.roomKey(roomId), 'ownerId');
    if (ownerId !== userId) return false;

    await this.redisClient.getClient().del(this.roomKey(roomId));
    await this.redisClient.getClient().del(this.membersKey(roomId));
    await this.redisClient.getClient().del(this.rolesKey(roomId));
    await this.redisClient.getClient().del(this.historyKey(roomId));

    this.localMembers.delete(roomId);
    this.memberRoles.delete(roomId);

    await this.pubSub.publish(IPC_CHANNELS.ROOM_EVENT, {
      roomId,
      userId,
      event: 'destroy',
    });

    return true;
  }

  async joinRoom(roomId: string, userId: string, password?: string): Promise<boolean> {
    const client = this.redisClient.getClient();
    const metaRaw = await client.hget(this.roomKey(roomId), 'metadata');
    if (!metaRaw) return false;

    const metadata = JSON.parse(metaRaw) as RoomMetadata;
    if (metadata.password && metadata.password !== password) return false;

    const membersKey = this.membersKey(roomId);
    const currentSize = await client.scard(membersKey);

    if (metadata.maxMembers && currentSize >= metadata.maxMembers) return false;

    await client.sadd(membersKey, userId);

    let local = this.localMembers.get(roomId);
    if (!local) {
      local = new Set();
      this.localMembers.set(roomId, local);
    }
    local.add(userId);

    let roles = this.memberRoles.get(roomId);
    if (!roles) {
      roles = new Map();
      this.memberRoles.set(roomId, roles);
    }
    roles.set(userId, 'member');

    await client.hset(this.rolesKey(roomId), userId, 'member');

    await this.pubSub.publish(IPC_CHANNELS.ROOM_EVENT, {
      roomId,
      userId,
      event: 'join',
    });

    return true;
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    await this.redisClient.getClient().srem(this.membersKey(roomId), userId);
    await this.redisClient.getClient().hdel(this.rolesKey(roomId), userId);

    const local = this.localMembers.get(roomId);
    if (local) {
      local.delete(userId);
      if (local.size === 0) this.localMembers.delete(roomId);
    }

    const roles = this.memberRoles.get(roomId);
    if (roles) {
      roles.delete(userId);
      if (roles.size === 0) this.memberRoles.delete(roomId);
    }

    await this.pubSub.publish(IPC_CHANNELS.ROOM_EVENT, {
      roomId,
      userId,
      event: 'leave',
    });
  }

  async updateRoomMetadata(roomId: string, userId: string, updates: Partial<RoomMetadata>): Promise<boolean> {
    const role = await this.getMemberRole(roomId, userId);
    if (role !== 'owner' && role !== 'admin') return false;

    const current = await this.getRoomMetadata(roomId);
    if (!current) return false;

    const updated = { ...current, ...updates };
    await this.redisClient.getClient().hset(this.roomKey(roomId), 'metadata', JSON.stringify(updated));

    await this.pubSub.publish(IPC_CHANNELS.ROOM_EVENT, {
      roomId,
      userId,
      event: 'update',
      metadata: updated,
    });

    return true;
  }

  async setMemberRole(roomId: string, operatorId: string, targetId: string, role: RoomRole): Promise<boolean> {
    const operatorRole = await this.getMemberRole(roomId, operatorId);
    if (operatorRole !== 'owner') return false;

    await this.redisClient.getClient().hset(this.rolesKey(roomId), targetId, role);

    const roles = this.memberRoles.get(roomId);
    if (roles) {
      roles.set(targetId, role);
    }

    return true;
  }

  async getMemberRole(roomId: string, userId: string): Promise<RoomRole> {
    const role = await this.redisClient.getClient().hget(this.rolesKey(roomId), userId);
    return (role as RoomRole) ?? 'member';
  }

  async getRoomMembers(roomId: string): Promise<RoomMemberInfo[]> {
    const client = this.redisClient.getClient();
    const memberIds = await client.smembers(this.membersKey(roomId));
    const roles = await client.hgetall(this.rolesKey(roomId));

    return memberIds.map((id) => ({
      userId: id,
      role: (roles[id] as RoomRole) ?? 'member',
      joinedAt: 0,
    }));
  }

  async getRoomMetadata(roomId: string): Promise<RoomMetadata | null> {
    const raw = await this.redisClient.getClient().hget(this.roomKey(roomId), 'metadata');
    if (!raw) return null;
    return JSON.parse(raw) as RoomMetadata;
  }

  async listRooms(options: RoomSearchOptions = {}): Promise<string[]> {
    const client = this.redisClient.getClient();
    const pattern = `${this.keyPrefix}room:*`;
    const keys = await client.keys(pattern);

    const roomIds: string[] = [];

    for (const key of keys) {
      if (key.endsWith(':members') || key.endsWith(':roles') || key.endsWith(':history')) continue;

      const roomId = key.replace(`${this.keyPrefix}room:`, '');
      const metadata = await this.getRoomMetadata(roomId);
      if (!metadata) continue;

      if (options.namePattern && metadata.name) {
        const regex = new RegExp(options.namePattern.replace('*', '.*'), 'i');
        if (!regex.test(metadata.name)) continue;
      }

      if (options.hasPassword !== undefined) {
        const hasPassword = !!metadata.password;
        if (hasPassword !== options.hasPassword) continue;
      }

      if (options.minMembers !== undefined || options.maxMembers !== undefined) {
        const memberCount = await client.scard(this.membersKey(roomId));
        if (options.minMembers !== undefined && memberCount < options.minMembers) continue;
        if (options.maxMembers !== undefined && memberCount > options.maxMembers) continue;
      }

      roomIds.push(roomId);
    }

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    return roomIds.slice(offset, offset + limit);
  }

  async addMessageToHistory(roomId: string, data: unknown, senderId?: string, messageType?: string): Promise<void> {
    const key = this.historyKey(roomId);
    const message = {
      data,
      senderId,
      messageType,
      timestamp: Date.now(),
    };

    await this.redisClient.getClient().lpush(key, JSON.stringify(message));
    await this.redisClient.getClient().ltrim(key, 0, this.maxHistorySize - 1);
  }

  async getMessageHistory(roomId: string, limit: number = 50): Promise<Array<{ data: unknown; senderId?: string; messageType?: string; timestamp: number }>> {
    const messages = await this.redisClient.getClient().lrange(this.historyKey(roomId), 0, limit - 1);
    return messages.map((m) => JSON.parse(m));
  }

  async broadcastToRoom(
    roomId: string,
    data: unknown,
    options: RoomMessageOptions & { messageType?: string } = {},
  ): Promise<void> {
    const senderId = options.excludeUserId;
    const messageType = options.messageType;

    await this.addMessageToHistory(roomId, data, senderId, messageType);

    this.handleLocalMessage(roomId, data, senderId, messageType);
    await this.pubSub.publish(IPC_CHANNELS.ROOM_MESSAGE, { roomId, data, senderId, messageType });
  }

  onRoomCreate(handler: RoomEventHandler): () => void {
    return this.onRoomEvent((roomId, event, userId, metadata) => {
      if (event === 'create') handler(roomId, event, userId, metadata);
    });
  }

  onRoomDestroy(handler: RoomEventHandler): () => void {
    return this.onRoomEvent((roomId, event, userId) => {
      if (event === 'destroy') handler(roomId, event, userId);
    });
  }

  onUserJoin(handler: RoomEventHandler): () => void {
    return this.onRoomEvent((roomId, event, userId) => {
      if (event === 'join') handler(roomId, event, userId);
    });
  }

  onUserLeave(handler: RoomEventHandler): () => void {
    return this.onRoomEvent((roomId, event, userId) => {
      if (event === 'leave') handler(roomId, event, userId);
    });
  }

  onRoomMessage(handler: RoomMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onRoomEvent(handler: RoomEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  async shutdown(): Promise<void> {
    await this.pubSub.unsubscribe(IPC_CHANNELS.ROOM_MESSAGE);
    await this.pubSub.unsubscribe(IPC_CHANNELS.ROOM_EVENT);
    this.localMembers.clear();
    this.memberRoles.clear();
    this.messageHandlers.clear();
    this.eventHandlers.clear();
    this.started = false;
  }

  private handleLocalMessage(roomId: string, data: unknown, senderId?: string, messageType?: string): void {
    for (const h of this.messageHandlers) h(roomId, data, senderId, messageType);
  }

  private handleRemoteEvent(
    roomId: string,
    event: 'create' | 'destroy' | 'join' | 'leave' | 'update',
    userId: string,
    metadata?: RoomMetadata,
  ): void {
    if (event === 'destroy') {
      this.localMembers.delete(roomId);
      this.memberRoles.delete(roomId);
    }
    for (const h of this.eventHandlers) h(roomId, event, userId, metadata);
  }

  private roomKey(roomId: string): string {
    return `${this.keyPrefix}room:${roomId}`;
  }

  private membersKey(roomId: string): string {
    return `${this.keyPrefix}room:${roomId}:members`;
  }

  private rolesKey(roomId: string): string {
    return `${this.keyPrefix}room:${roomId}:roles`;
  }

  private historyKey(roomId: string): string {
    return `${this.keyPrefix}room:${roomId}:history`;
  }
}
