import { Redis, type RedisOptions } from 'ioredis';
import { randomUUID } from 'node:crypto';

export interface RedisClientOptions {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  instanceId?: string;
  maxRetriesPerRequest?: number | null;
  enableReadyCheck?: boolean;
  reconnectOnError?: (err: Error) => boolean | 'READONLY';
}

export type RedisConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export class RedisClient {
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private readonly instanceId: string;
  private status: RedisConnectionStatus = 'disconnected';

  constructor(private readonly options: RedisClientOptions = {}) {
    this.instanceId = options.instanceId ?? process.env.INSTANCE_ID ?? randomUUID();
  }

  async connect(): Promise<void> {
    const redisOpts = this.buildRedisOptions();
    this.client = new Redis(redisOpts);
    this.subscriber = new Redis(redisOpts);
    await this.waitForReady(this.client);
    this.status = 'connected';
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    const jobs: Promise<void>[] = [];
    if (this.subscriber) {
      jobs.push(
        (async () => {
          try {
            this.subscriber!.unsubscribe();
            this.subscriber!.punsubscribe();
            await this.subscriber!.quit();
          } catch { /* ignore */ }
        })(),
      );
      this.subscriber = null;
    }
    if (this.client) {
      jobs.push(
        (async () => {
          try {
            await this.client!.quit();
          } catch { /* ignore */ }
        })(),
      );
      this.client = null;
    }
    await Promise.all(jobs);
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  getClient(): Redis {
    if (!this.client) throw new Error('RedisClient not connected. Call connect() first.');
    return this.client;
  }

  getSubscriber(): Redis {
    if (!this.subscriber) throw new Error('RedisClient not connected. Call connect() first.');
    return this.subscriber;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  getStatus(): RedisConnectionStatus {
    return this.status;
  }

  onStatusChange(listener: (status: RedisConnectionStatus) => void): () => void {
    const client = this.client;
    if (!client) return () => {};

    const handlers = {
      connect: () => {
        this.status = 'connected';
        listener(this.status);
      },
      close: () => {
        this.status = 'disconnected';
        listener(this.status);
      },
      reconnecting: () => {
        this.status = 'reconnecting';
        listener(this.status);
      },
    };

    client.on('connect', handlers.connect);
    client.on('close', handlers.close);
    client.on('reconnecting', handlers.reconnecting);

    return () => {
      client.off('connect', handlers.connect);
      client.off('close', handlers.close);
      client.off('reconnecting', handlers.reconnecting);
    };
  }

  private async waitForReady(client: Redis, timeoutMs = 5000): Promise<void> {
    if (client.status === 'ready') return;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Redis connection timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        client.off('ready', onReady);
        client.off('error', onError);
      };

      client.once('ready', onReady);
      client.once('error', onError);
    });
  }

  private buildRedisOptions(): RedisOptions {
    return {
      host: this.options.host ?? '127.0.0.1',
      port: this.options.port ?? 6379,
      password: this.options.password,
      db: this.options.db ?? 0,
      keyPrefix: this.options.keyPrefix,
      maxRetriesPerRequest: this.options.maxRetriesPerRequest ?? null,
      enableReadyCheck: this.options.enableReadyCheck ?? true,
      lazyConnect: false,
      retryStrategy: (times: number) => {
        if (times > 50) return null;
        return Math.min(times * 100, 3000);
      },
    };
  }
}
