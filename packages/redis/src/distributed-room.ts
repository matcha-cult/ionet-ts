import type { RedisClient } from './redis-client.js';
import type { RedisPubSub } from './redis-pub-sub.js';
import { IPC_CHANNELS, type IpcMessage } from './redis-types.js';

export interface RoomMetadata {
  name?: string;
  maxMembers?: number;
  password?: string;
  [key: string]: unknown;
}

export type RoomMessageHandler = (roomId: string, data: unknown, senderId?: string) => void;
export type RoomEventHandler = (
  roomId: string,
  event: 'join' | 'leave' | 'destroy',
  userId: string,
) => void;

export interface DistributedRoomOptions {
  keyPrefix?: string;
}

export class DistributedRoom {
  private readonly keyPrefix: string;
  private readonly localMembers = new Map<string, Set<string>>();
  private readonly messageHandlers = new Set<RoomMessageHandler>();
  private readonly eventHandlers = new Set<RoomEventHandler>();
  private started = false;

  constructor(
    private readonly redisClient: RedisClient,
    private readonly pubSub: RedisPubSub,
    options: DistributedRoomOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ionet:';
  }

  async start(): Promise<void> {
    if (this.started) return;

    await this.pubSub.subscribe(IPC_CHANNELS.ROOM_MESSAGE, (_ch, msg) => {
      const payload = msg.payload as { roomId: string; data: unknown; senderId?: string };
      this.handleLocalMessage(payload.roomId, payload.data, payload.senderId);
    });

    await this.pubSub.subscribe(IPC_CHANNELS.ROOM_EVENT, (_ch, msg) => {
      const payload = msg.payload as { roomId: string; userId: string; event: 'join' | 'leave' | 'destroy' };
      this.handleRemoteEvent(payload.roomId, payload.event, payload.userId);
    });

    this.started = true;
  }

  async createRoom(roomId: string, metadata: RoomMetadata = {}): Promise<void> {
    const key = this.roomKey(roomId);
    await this.redisClient.getClient().hset(key, 'metadata', JSON.stringify(metadata));
    await this.redisClient.getClient().hset(key, 'createdAt', String(Date.now()));
  }

  async destroyRoom(roomId: string): Promise<void> {
    await this.redisClient.getClient().del(this.roomKey(roomId));
    await this.redisClient.getClient().del(this.membersKey(roomId));

    this.localMembers.delete(roomId);

    await this.pubSub.publish(IPC_CHANNELS.ROOM_EVENT, {
      roomId,
      userId: '',
      event: 'destroy',
    });
  }

  async joinRoom(roomId: string, userId: string): Promise<boolean> {
    const metaRaw = await this.redisClient.getClient().hget(this.roomKey(roomId), 'metadata');
    if (!metaRaw) return false;

    const metadata = JSON.parse(metaRaw) as RoomMetadata;
    const membersKey = this.membersKey(roomId);
    const currentSize = await this.redisClient.getClient().scard(membersKey);

    if (metadata.maxMembers && currentSize >= metadata.maxMembers) return false;

    await this.redisClient.getClient().sadd(membersKey, userId);

    let local = this.localMembers.get(roomId);
    if (!local) {
      local = new Set();
      this.localMembers.set(roomId, local);
    }
    local.add(userId);

    await this.pubSub.publish(IPC_CHANNELS.ROOM_EVENT, { roomId, userId, event: 'join' });
    return true;
  }

  async leaveRoom(roomId: string, userId: string): Promise<void> {
    await this.redisClient.getClient().srem(this.membersKey(roomId), userId);

    const local = this.localMembers.get(roomId);
    if (local) {
      local.delete(userId);
      if (local.size === 0) this.localMembers.delete(roomId);
    }

    await this.pubSub.publish(IPC_CHANNELS.ROOM_EVENT, { roomId, userId, event: 'leave' });
  }

  async getRoomMembers(roomId: string): Promise<string[]> {
    return this.redisClient.getClient().smembers(this.membersKey(roomId));
  }

  async getRoomMetadata(roomId: string): Promise<RoomMetadata | null> {
    const raw = await this.redisClient.getClient().hget(this.roomKey(roomId), 'metadata');
    if (!raw) return null;
    return JSON.parse(raw) as RoomMetadata;
  }

  async getLocalMembers(roomId: string): Promise<string[]> {
    const local = this.localMembers.get(roomId);
    return local ? [...local] : [];
  }

  async broadcastToRoom(roomId: string, data: unknown, senderId?: string): Promise<void> {
    this.handleLocalMessage(roomId, data, senderId);
    await this.pubSub.publish(IPC_CHANNELS.ROOM_MESSAGE, { roomId, data, senderId });
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
    this.messageHandlers.clear();
    this.eventHandlers.clear();
    this.started = false;
  }

  private handleLocalMessage(roomId: string, data: unknown, senderId?: string): void {
    for (const h of this.messageHandlers) h(roomId, data, senderId);
  }

  private handleRemoteEvent(roomId: string, event: 'join' | 'leave' | 'destroy', userId: string): void {
    if (event === 'destroy') {
      this.localMembers.delete(roomId);
    }
    for (const h of this.eventHandlers) h(roomId, event, userId);
  }

  private roomKey(roomId: string): string {
    return `${this.keyPrefix}room:${roomId}`;
  }

  private membersKey(roomId: string): string {
    return `${this.keyPrefix}room:${roomId}:members`;
  }
}
