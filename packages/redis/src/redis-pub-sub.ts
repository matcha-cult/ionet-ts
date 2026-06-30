import type { Redis } from 'ioredis';
import type { RedisClient } from './redis-client.js';
import {
  IPC_CHANNELS,
  type IpcMessage,
  createIpcMessage,
} from './redis-types.js';

export type PubSubHandler = (channel: string, message: IpcMessage) => void;

export interface RedisPubSubOptions {
  keyPrefix?: string;
}

export class RedisPubSub {
  private readonly handlers = new Map<string, Set<PubSubHandler>>();
  private readonly patternHandlers = new Map<string, Set<PubSubHandler>>();
  private connected = false;

  constructor(
    private readonly redisClient: RedisClient,
    private readonly options: RedisPubSubOptions = {},
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    const subscriber = this.redisClient.getSubscriber();
    subscriber.on('message', (channel: string, raw: string) => {
      this.handleMessage(channel, raw);
    });
    subscriber.on('pmessage', (_pattern: string, channel: string, raw: string) => {
      this.handleMessage(channel, raw);
    });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    const subscriber = this.redisClient.getSubscriber();
    subscriber.unsubscribe();
    subscriber.punsubscribe();
    this.handlers.clear();
    this.patternHandlers.clear();
    this.connected = false;
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    const message = createIpcMessage(this.redisClient.getInstanceId(), channel, payload);
    const prefixed = this.prefix(channel);
    await this.redisClient.getClient().publish(prefixed, JSON.stringify(message));
  }

  async subscribe(channel: string, handler: PubSubHandler): Promise<void> {
    let handlers = this.handlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(channel, handlers);
    }
    const isFirst = handlers.size === 0;
    handlers.add(handler);

    if (isFirst) {
      await this.redisClient.getSubscriber().subscribe(this.prefix(channel));
    }
  }

  async unsubscribe(channel: string, handler?: PubSubHandler): Promise<void> {
    const handlers = this.handlers.get(channel);
    if (!handlers) return;

    if (handler) {
      handlers.delete(handler);
      if (handlers.size > 0) return;
    }
    this.handlers.delete(channel);
    await this.redisClient.getSubscriber().unsubscribe(this.prefix(channel));
  }

  async psubscribe(pattern: string, handler: PubSubHandler): Promise<void> {
    let handlers = this.patternHandlers.get(pattern);
    if (!handlers) {
      handlers = new Set();
      this.patternHandlers.set(pattern, handlers);
    }
    const isFirst = handlers.size === 0;
    handlers.add(handler);

    if (isFirst) {
      await this.redisClient.getSubscriber().psubscribe(this.prefix(pattern));
    }
  }

  async punsubscribe(pattern: string, handler?: PubSubHandler): Promise<void> {
    const handlers = this.patternHandlers.get(pattern);
    if (!handlers) return;

    if (handler) {
      handlers.delete(handler);
      if (handlers.size > 0) return;
    }
    this.patternHandlers.delete(pattern);
    await this.redisClient.getSubscriber().punsubscribe(this.prefix(pattern));
  }

  private handleMessage(prefixedChannel: string, raw: string): void {
    const channel = this.unprefix(prefixedChannel);
    let message: IpcMessage;
    try {
      message = JSON.parse(raw) as IpcMessage;
    } catch {
      return;
    }

    for (const [ch, handlers] of this.handlers) {
      if (ch === channel) {
        for (const h of handlers) h(ch, message);
      }
    }

    for (const [pattern, handlers] of this.patternHandlers) {
      if (this.matchPattern(pattern, channel)) {
        for (const h of handlers) h(channel, message);
      }
    }
  }

  private prefix(channel: string): string {
    const p = this.options.keyPrefix ?? '';
    return p ? `${p}${channel}` : channel;
  }

  private unprefix(prefixed: string): string {
    const p = this.options.keyPrefix ?? '';
    return p && prefixed.startsWith(p) ? prefixed.slice(p.length) : prefixed;
  }

  private matchPattern(pattern: string, channel: string): boolean {
    const regex = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return regex.test(channel);
  }
}
