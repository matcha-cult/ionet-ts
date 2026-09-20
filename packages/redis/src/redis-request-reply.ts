import { randomUUID } from 'node:crypto';
import type { RedisClient } from './redis-client.js';
import type { RedisPubSub } from './redis-pub-sub.js';

/**
 * RS4 —— Redis 进程间请求/响应 RPC。
 *
 * 协议：每个实例订阅自己的通道 `{prefix}rpc:{instanceId}`。
 * - `kind: 'request'` 携带 correlationId / replyTo / handler / payload；
 * - `kind: 'reply'`   携带 correlationId / ok / payload|errorMessage。
 *
 * 显式声明的投递保证（KB `communication-logic-call-api-contract` 要求不得静默推断）：
 * - **至多一次**：不重试、不承诺顺序；
 * - 超时抛 `RpcTimeoutError`（由上层据注册表存活状态细分为 PEER_OFFLINE）；
 * - 对端 handler 抛错时回包 `ok:false`，调用方 reject `RpcPeerError`；
 * - 重复/迟到回包去重并显式告警，不会二次 resolve。
 */
export interface RpcRequestMessage {
  correlationId: string;
  kind: 'request';
  /** 请求方实例 id（回包目标）。 */
  replyTo: string;
  /** 应答方 handler 名（如 'action'）。 */
  handler: string;
  payload: unknown;
  sentAt: number;
  /** true 表示单向发送：对端执行但不回包。 */
  noReply?: boolean;
}

export interface RpcReplyMessage {
  correlationId: string;
  kind: 'reply';
  ok: boolean;
  payload?: unknown;
  errorMessage?: string;
  repliedAt: number;
}

export type RpcHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  message: RpcRequestMessage,
) => Promise<TResult> | TResult;

export class RpcTimeoutError extends Error {
  readonly code = 'TIMEOUT';
  constructor(
    message: string,
    readonly targetInstanceId: string,
    readonly handler: string,
    readonly timeoutMs: number,
  ) {
    super(message);
    this.name = 'RpcTimeoutError';
  }
}

export class RpcPeerError extends Error {
  readonly code = 'REMOTE_ERROR';
  constructor(message: string, readonly targetInstanceId?: string) {
    super(message);
    this.name = 'RpcPeerError';
  }
}

export interface RedisRequestReplyOptions {
  keyPrefix?: string;
  instanceId?: string;
  defaultTimeoutMs?: number;
  seenReplyLimit?: number;
}

export interface RpcStats {
  pending: number;
  seenReplies: number;
  duplicateReplies: number;
  lateReplies: number;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  targetInstanceId: string;
  handler: string;
  timeoutMs: number;
  sentAt: number;
}

export class RedisRequestReply {
  private readonly instanceId: string;
  private readonly keyPrefix: string;
  private readonly defaultTimeoutMs: number;
  private readonly seenReplyLimit: number;
  private readonly pending = new Map<string, PendingCall>();
  private readonly handlers = new Map<string, RpcHandler>();
  private readonly seenReplies = new Set<string>();
  private started = false;
  private duplicateReplies = 0;
  private lateReplies = 0;

  constructor(
    private readonly redisClient: RedisClient,
    private readonly pubSub: RedisPubSub,
    options: RedisRequestReplyOptions = {},
  ) {
    this.instanceId = options.instanceId ?? redisClient.getInstanceId();
    this.keyPrefix = options.keyPrefix ?? 'ionet:';
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
    this.seenReplyLimit = options.seenReplyLimit ?? 4096;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  /** 本实例订阅的 RPC 通道（未加 RedisPubSub 的额外前缀）。 */
  getChannel(): string {
    return `${this.keyPrefix}rpc:${this.instanceId}`;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.pubSub.subscribe(this.getChannel(), (_channel, message) => {
      void this.handleMessage(message.payload);
    });
    this.started = true;
  }

  async stop(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new RpcPeerError('RPC client stopped'));
    }
    this.pending.clear();
    if (this.started) {
      await this.pubSub.unsubscribe(this.getChannel());
    }
    this.handlers.clear();
    this.seenReplies.clear();
    this.started = false;
  }

  registerHandler(name: string, handler: RpcHandler): void {
    this.handlers.set(name, handler);
  }

  unregisterHandler(name: string): void {
    this.handlers.delete(name);
  }

  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  getStats(): RpcStats {
    return {
      pending: this.pending.size,
      seenReplies: this.seenReplies.size,
      duplicateReplies: this.duplicateReplies,
      lateReplies: this.lateReplies,
    };
  }

  /**
   * 请求/响应调用。失败时：
   * - 超时 → `RpcTimeoutError`
   * - 对端 handler 报错 → `RpcPeerError`
   */
  async call<TReply = unknown>(
    targetInstanceId: string,
    handler: string,
    payload: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<TReply> {
    const correlationId = randomUUID();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const request: RpcRequestMessage = {
      correlationId,
      kind: 'request',
      replyTo: this.instanceId,
      handler,
      payload,
      sentAt: Date.now(),
    };

    const promise = new Promise<TReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(
          new RpcTimeoutError(
            `RPC timeout after ${timeoutMs}ms (target=${targetInstanceId}, handler=${handler})`,
            targetInstanceId,
            handler,
            timeoutMs,
          ),
        );
      }, timeoutMs);
      this.pending.set(correlationId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        targetInstanceId,
        handler,
        timeoutMs,
        sentAt: Date.now(),
      });
    });

    try {
      await this.pubSub.publish(this.channelFor(targetInstanceId), request);
    } catch (error) {
      const pending = this.pending.get(correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(correlationId);
      }
      throw error;
    }

    return promise;
  }

  /** 单向发送：对端执行但不回包；仅保证已投递到 Redis（不承诺对端执行成功）。 */
  async send(targetInstanceId: string, handler: string, payload: unknown): Promise<void> {
    const request: RpcRequestMessage = {
      correlationId: randomUUID(),
      kind: 'request',
      replyTo: this.instanceId,
      handler,
      payload,
      sentAt: Date.now(),
      noReply: true,
    };
    await this.pubSub.publish(this.channelFor(targetInstanceId), request);
  }

  private channelFor(instanceId: string): string {
    return `${this.keyPrefix}rpc:${instanceId}`;
  }

  private async handleMessage(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as RpcRequestMessage | RpcReplyMessage;
    if (message.kind === 'request') {
      await this.handleRequest(message);
      return;
    }
    if (message.kind === 'reply') {
      this.handleReply(message);
    }
  }

  private async handleRequest(message: RpcRequestMessage): Promise<void> {
    const handler = this.handlers.get(message.handler);

    if (message.noReply) {
      if (!handler) {
        console.warn(
          `[ionet] RPC send dropped: no handler '${message.handler}' on instance ${this.instanceId}`,
        );
        return;
      }
      try {
        await handler(message.payload, message);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[ionet] RPC send handler '${message.handler}' failed: ${detail}`);
      }
      return;
    }

    let reply: RpcReplyMessage;
    if (!handler) {
      reply = {
        correlationId: message.correlationId,
        kind: 'reply',
        ok: false,
        errorMessage: `No RPC handler '${message.handler}' on instance ${this.instanceId}`,
        repliedAt: Date.now(),
      };
    } else {
      try {
        const result = await handler(message.payload, message);
        reply = {
          correlationId: message.correlationId,
          kind: 'reply',
          ok: true,
          payload: result,
          repliedAt: Date.now(),
        };
      } catch (error) {
        reply = {
          correlationId: message.correlationId,
          kind: 'reply',
          ok: false,
          errorMessage: error instanceof Error ? error.message : String(error),
          repliedAt: Date.now(),
        };
      }
    }

    await this.pubSub.publish(this.channelFor(message.replyTo), reply);
  }

  private handleReply(message: RpcReplyMessage): void {
    const pending = this.pending.get(message.correlationId);
    if (!pending) {
      // 回包去重：已见过 = 重复回包；未见过 = 超时后的迟到回包。
      if (this.seenReplies.has(message.correlationId)) {
        this.duplicateReplies++;
        console.warn(`[ionet] duplicate RPC reply ignored: ${message.correlationId}`);
      } else {
        this.lateReplies++;
        console.warn(`[ionet] late/unknown RPC reply ignored: ${message.correlationId}`);
      }
      this.markSeen(message.correlationId);
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(message.correlationId);
    this.markSeen(message.correlationId);

    if (!message.ok) {
      pending.reject(
        new RpcPeerError(message.errorMessage ?? 'remote RPC error', pending.targetInstanceId),
      );
      return;
    }
    pending.resolve(message.payload);
  }

  private markSeen(correlationId: string): void {
    this.seenReplies.add(correlationId);
    if (this.seenReplies.size > this.seenReplyLimit) {
      const oldest = this.seenReplies.values().next().value;
      if (oldest !== undefined) {
        this.seenReplies.delete(oldest);
      }
    }
  }
}
