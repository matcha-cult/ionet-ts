import {
  type OnExternalContext,
  type OnExternalRegistry,
} from '@nbb-ionet/core-framework';
import type { RedisClient } from './redis-client.js';
import type { RedisPubSub } from './redis-pub-sub.js';

export interface RedisOnExternalTransportOptions {
  keyPrefix?: string;
  /** 本对外服实例 id；订阅定向通道用。 */
  instanceId?: string;
}

/**
 * RS6 —— OnExternal 的 Redis 传输层（对外服侧订阅、逻辑服侧发送）。
 *
 * 通道：
 * - `{prefix}onexternal:{instanceId}` 定向：只投递给目标对外服实例
 * - `{prefix}onexternal`              广播：所有对外服实例
 *
 * 对外服实例 `start()` 后，收到的消息按 templateId 分发到本实例 `OnExternalRegistry`；
 * handler 缺失时记录显式告警（不静默）。
 */
export class RedisOnExternalTransport {
  private readonly keyPrefix: string;
  private readonly instanceId: string;
  private started = false;

  constructor(
    private readonly redisClient: RedisClient,
    private readonly pubSub: RedisPubSub,
    private readonly registry: OnExternalRegistry | null,
    options: RedisOnExternalTransportOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ionet:';
    this.instanceId = options.instanceId ?? redisClient.getInstanceId();
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  getTargetChannel(instanceId: string): string {
    return `${this.keyPrefix}onexternal:${instanceId}`;
  }

  getBroadcastChannel(): string {
    return `${this.keyPrefix}onexternal`;
  }

  /** 订阅本实例定向通道 + 广播通道。需要 registry（对外服侧）；仅发送方可不调用。 */
  async start(): Promise<void> {
    if (this.started) return;
    if (!this.registry) {
      throw new Error(
        'RedisOnExternalTransport.start() requires an OnExternalRegistry (external-server side)',
      );
    }
    await this.pubSub.subscribe(this.getBroadcastChannel(), (_channel, message) => {
      void this.handle(message.payload as OnExternalContext);
    });
    await this.pubSub.subscribe(this.getTargetChannel(this.instanceId), (_channel, message) => {
      void this.handle(message.payload as OnExternalContext);
    });
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.pubSub.unsubscribe(this.getBroadcastChannel());
    await this.pubSub.unsubscribe(this.getTargetChannel(this.instanceId));
    this.started = false;
  }

  /**
   * 发送 OnExternal 指令。
   * @param context 指令内容（targetInstanceId 由本方法决定是否写入）
   * @param targetInstanceId 定向目标；缺省广播给全部对外服
   */
  async send(context: OnExternalContext, targetInstanceId?: string): Promise<void> {
    const envelope: OnExternalContext = {
      ...context,
      sourceInstanceId: context.sourceInstanceId ?? this.instanceId,
      targetInstanceId: targetInstanceId ?? context.targetInstanceId,
    };
    const channel = targetInstanceId
      ? this.getTargetChannel(targetInstanceId)
      : this.getBroadcastChannel();
    await this.pubSub.publish(channel, envelope);
  }

  private async handle(context: OnExternalContext): Promise<void> {
    if (!this.registry) return;
    try {
      await this.registry.dispatch(context);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[ionet] OnExternal dispatch failed: ${detail}`);
    }
  }
}
