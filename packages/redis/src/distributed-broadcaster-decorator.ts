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

export interface DistributedBroadcasterDecoratorOptions {
  instanceId?: string;
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
    this.instanceId = options.instanceId ?? randomUUID();
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
    await this.pubSub.unsubscribe(BROADCAST_CHANNELS.USERS);
    await this.pubSub.unsubscribe(BROADCAST_CHANNELS.ROOM);

    this.subscribed = false;
  }

  async broadcastToAll(message: BroadcastMessage): Promise<void> {
    await this.local.broadcastToAll(message);
    await this.pubSub.publish(BROADCAST_CHANNELS.ALL, this.wrap(message));
  }

  async broadcastToUser(userId: string, message: BroadcastMessage): Promise<void> {
    if (this.connections.isLocalUser(userId)) {
      await this.local.broadcastToUser(userId, message);
      return;
    }
    await this.pubSub.publish(BROADCAST_CHANNELS.USER, this.wrap({ userId, message }));
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
