import type { RedisClient } from './redis-client.js';
import type { RedisPubSub } from './redis-pub-sub.js';
import { IPC_CHANNELS, type IpcMessage } from './redis-types.js';

export type LocalMessageHandler = (data: unknown) => void;

export interface DistributedBroadcasterOptions {
  keyPrefix?: string;
}

export class DistributedBroadcaster {
  private readonly keyPrefix: string;
  private readonly userInstanceMap = new Map<string, string>();
  private readonly localUserHandlers = new Map<string, Set<LocalMessageHandler>>();
  private readonly globalHandlers = new Set<(data: unknown, fromUserId?: string) => void>();
  private started = false;

  constructor(
    private readonly redisClient: RedisClient,
    private readonly pubSub: RedisPubSub,
    options: DistributedBroadcasterOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ionet:';
  }

  async start(): Promise<void> {
    if (this.started) return;

    await this.pubSub.subscribe(IPC_CHANNELS.BROADCAST, (_ch, msg) => {
      const payload = msg.payload as { data: unknown; excludeUserId?: string };
      this.deliverToAllLocal(payload.data, payload.excludeUserId);
    });

    await this.pubSub.subscribe(IPC_CHANNELS.USER_MESSAGE, (_ch, msg) => {
      const payload = msg.payload as { userId: string; data: unknown };
      this.deliverToLocalUser(payload.userId, payload.data);
    });

    this.started = true;
  }

  registerLocalUser(userId: string, handler: LocalMessageHandler): void {
    let handlers = this.localUserHandlers.get(userId);
    if (!handlers) {
      handlers = new Set();
      this.localUserHandlers.set(userId, handlers);
    }
    handlers.add(handler);
    this.userInstanceMap.set(userId, this.redisClient.getInstanceId());

    void this.redisClient.getClient().hset(
      this.userInstanceKey(),
      userId,
      this.redisClient.getInstanceId(),
    );
  }

  unregisterLocalUser(userId: string): void {
    this.localUserHandlers.delete(userId);
    this.userInstanceMap.delete(userId);

    void this.redisClient.getClient().hdel(this.userInstanceKey(), userId);
  }

  onGlobalBroadcast(handler: (data: unknown, fromUserId?: string) => void): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  async broadcastToAll(data: unknown, excludeUserId?: string): Promise<void> {
    this.deliverToAllLocal(data, excludeUserId);
    await this.pubSub.publish(IPC_CHANNELS.BROADCAST, { data, excludeUserId });
  }

  async broadcastToUser(userId: string, data: unknown): Promise<void> {
    const localHandlers = this.localUserHandlers.get(userId);
    if (localHandlers && localHandlers.size > 0) {
      this.deliverToLocalUser(userId, data);
      return;
    }

    const instanceId = await this.redisClient
      .getClient()
      .hget(this.userInstanceKey(), userId);

    if (!instanceId) return;

    await this.pubSub.publish(IPC_CHANNELS.USER_MESSAGE, { userId, data });
  }

  getUserInstance(userId: string): string | undefined {
    return this.userInstanceMap.get(userId);
  }

  getLocalConnectionCount(): number {
    return this.localUserHandlers.size;
  }

  async shutdown(): Promise<void> {
    for (const userId of [...this.localUserHandlers.keys()]) {
      this.unregisterLocalUser(userId);
    }
    await this.pubSub.unsubscribe(IPC_CHANNELS.BROADCAST);
    await this.pubSub.unsubscribe(IPC_CHANNELS.USER_MESSAGE);
    this.globalHandlers.clear();
    this.started = false;
  }

  private deliverToLocalUser(userId: string, data: unknown): void {
    const handlers = this.localUserHandlers.get(userId);
    if (handlers) {
      for (const h of handlers) h(data);
    }
  }

  private deliverToAllLocal(data: unknown, excludeUserId?: string): void {
    for (const [userId, handlers] of this.localUserHandlers) {
      if (userId === excludeUserId) continue;
      for (const h of handlers) h(data);
    }
    for (const h of this.globalHandlers) h(data);
  }

  private userInstanceKey(): string {
    return `${this.keyPrefix}user-instance`;
  }
}
