import { getDomainEventType, type DomainEventBase } from './decorators.js';

export type EventHandler<T = any> = (event: T) => void | Promise<void>;

export interface EventSubscription {
  eventType: string;
  handler: EventHandler;
  partitionKey?: string;
}

export class DomainEventBus {
  private subscriptions = new Map<string, Set<EventSubscription>>();
  private partitionQueues = new Map<string, Array<() => Promise<void>>>();
  private processing = new Map<string, boolean>();

  publish<T extends DomainEventBase>(event: T, partitionKey?: string): Promise<void> {
    const eventType = getDomainEventType(event.constructor);
    const subs = this.subscriptions.get(eventType);

    if (!subs || subs.size === 0) {
      return Promise.resolve();
    }

    const tasks: Promise<void>[] = [];

    for (const sub of subs) {
      const key = partitionKey ?? sub.partitionKey ?? 'default';

      if (key === 'default') {
        tasks.push(this.executeHandler(sub.handler, event));
      } else {
        tasks.push(this.enqueueForPartition(key, sub.handler, event));
      }
    }

    return Promise.all(tasks).then(() => {});
  }

  subscribe<T extends DomainEventBase>(
    eventType: string | (new (...args: any[]) => T),
    handler: EventHandler<T>,
    options?: { partitionKey?: string }
  ): () => void {
    const type = typeof eventType === 'string' ? eventType : getDomainEventType(eventType);

    const subscription: EventSubscription = {
      eventType: type,
      handler,
      partitionKey: options?.partitionKey,
    };

    if (!this.subscriptions.has(type)) {
      this.subscriptions.set(type, new Set());
    }

    this.subscriptions.get(type)!.add(subscription);

    return () => {
      this.subscriptions.get(type)?.delete(subscription);
    };
  }

  subscribeWithPartition<T extends DomainEventBase>(
    eventType: string | (new (...args: any[]) => T),
    handler: EventHandler<T>,
    partitionExtractor: (event: T) => string
  ): () => void {
    const type = typeof eventType === 'string' ? eventType : getDomainEventType(eventType);

    const wrappedHandler: EventHandler = async (event: T) => {
      const partitionKey = partitionExtractor(event);
      await this.enqueueForPartition(partitionKey, handler, event);
    };

    const subscription: EventSubscription = {
      eventType: type,
      handler: wrappedHandler,
    };

    if (!this.subscriptions.has(type)) {
      this.subscriptions.set(type, new Set());
    }

    this.subscriptions.get(type)!.add(subscription);

    return () => {
      this.subscriptions.get(type)?.delete(subscription);
    };
  }

  private async executeHandler<T>(handler: EventHandler<T>, event: T): Promise<void> {
    try {
      await handler(event);
    } catch (error) {
      console.error('Event handler error:', error);
      throw error;
    }
  }

  private async enqueueForPartition<T>(
    partitionKey: string,
    handler: EventHandler<T>,
    event: T
  ): Promise<void> {
    if (!this.partitionQueues.has(partitionKey)) {
      this.partitionQueues.set(partitionKey, []);
    }

    const queue = this.partitionQueues.get(partitionKey)!;

    return new Promise<void>((resolve, reject) => {
      queue.push(async () => {
        try {
          await handler(event);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.processPartitionQueue(partitionKey);
    });
  }

  private async processPartitionQueue(partitionKey: string): Promise<void> {
    if (this.processing.get(partitionKey)) {
      return;
    }

    this.processing.set(partitionKey, true);

    try {
      const queue = this.partitionQueues.get(partitionKey)!;

      while (queue.length > 0) {
        const task = queue.shift()!;
        await task();
      }
    } finally {
      this.processing.set(partitionKey, false);
    }
  }

  clear(): void {
    this.subscriptions.clear();
    this.partitionQueues.clear();
    this.processing.clear();
  }
}

export const domainEventBus = new DomainEventBus();
