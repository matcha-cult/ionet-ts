import type { RedisClient } from './redis-client.js';
import type { RedisPubSub } from './redis-pub-sub.js';
import type { InstanceManager } from './instance-manager.js';
import type { DistributedBroadcaster } from './distributed-broadcaster.js';
import type { DistributedRoom } from './distributed-room.js';
import type { DistributedLock } from './distributed-lock.js';

export interface GracefulShutdownOptions {
  timeoutMs?: number;
  signals?: NodeJS.Signals[];
  onShutdown?: () => Promise<void> | void;
}

export class GracefulShutdown {
  private shuttingDown = false;
  private readonly timeoutMs: number;
  private readonly signals: NodeJS.Signals[];
  private readonly cleanupHandlers: Array<() => Promise<void> | void> = [];
  private onShutdown?: () => Promise<void> | void;

  constructor(options: GracefulShutdownOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.signals = options.signals ?? ['SIGINT', 'SIGTERM'];
    this.onShutdown = options.onShutdown;
  }

  addHandler(handler: () => Promise<void> | void): void {
    this.cleanupHandlers.push(handler);
  }

  register(
    redisClient: RedisClient,
    instanceManager: InstanceManager,
    broadcaster: DistributedBroadcaster,
    room: DistributedRoom,
    lock: DistributedLock,
    pubSub: RedisPubSub,
  ): void {
    this.addHandler(async () => {
      await broadcaster.shutdown();
      await room.shutdown();
      await lock.shutdown();
      await instanceManager.unregister();
      await pubSub.disconnect();
      await redisClient.disconnect();
    });
  }

  start(): void {
    for (const signal of this.signals) {
      process.on(signal, () => {
        void this.shutdown(signal);
      });
    }
  }

  async shutdown(signal?: NodeJS.Signals): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const logPrefix = signal ? `Received ${signal},` : 'Manual';
    console.log(`[${logPrefix}] starting graceful shutdown...`);

    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Shutdown timeout')), this.timeoutMs);
    });

    try {
      await Promise.race([
        this.runCleanup(),
        timeout,
      ]);
      console.log('Graceful shutdown completed');
    } catch (err) {
      console.error('Graceful shutdown error:', err);
    } finally {
      process.exit(0);
    }
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  private async runCleanup(): Promise<void> {
    if (this.onShutdown) await this.onShutdown();

    for (const handler of this.cleanupHandlers.reverse()) {
      try {
        await handler();
      } catch (err) {
        console.error('Cleanup handler error:', err);
      }
    }
  }
}
