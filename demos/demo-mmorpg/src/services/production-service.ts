import type { RedisClient } from '@nbb-ionet/redis';
import { getTaskConfig } from '../config/task-config.js';
import type { ItemService } from './item-service.js';

export interface CurrentTask {
  type: string;
  startTime: number;
  duration: number;
}

export interface ProductionState {
  current: CurrentTask | null;
  queue: string[];
}

const MAX_OFFLINE_HOURS = 24; // 最大离线生产时间

export class ProductionService {
  constructor(
    private redis: RedisClient,
    private itemService: ItemService,
  ) {}

  async startTask(userId: bigint, taskType: string): Promise<{ success: boolean; startTime: number }> {
    const config = getTaskConfig(taskType);
    if (!config) {
      throw new Error(`Unknown task type: ${taskType}`);
    }

    const current = await this.getCurrentTask(userId);
    if (current) {
      throw new Error('Already has a current task');
    }

    const startTime = Date.now();
    const key = `player:${userId}:current`;

    await this.redis.getClient().hset(key, {
      type: taskType,
      startTime: startTime.toString(),
      duration: config.duration.toString(),
    });

    await this.redis.getClient().zadd('production:active', startTime + config.duration, userId.toString());

    return { success: true, startTime };
  }

  async cancelTask(userId: bigint): Promise<boolean> {
    await this.redis.getClient().del(`player:${userId}:current`);
    await this.redis.getClient().zrem('production:active', userId.toString());
    return true;
  }

  async getState(userId: bigint): Promise<ProductionState> {
    const current = await this.getCurrentTask(userId);
    const queue = await this.redis.getClient().lrange(`player:${userId}:queue`, 0, -1);

    return {
      current,
      queue,
    };
  }

  async addToQueue(userId: bigint, taskType: string): Promise<{ success: boolean; queueLength: number }> {
    const config = getTaskConfig(taskType);
    if (!config) {
      throw new Error(`Unknown task type: ${taskType}`);
    }

    const queueLength = await this.redis.getClient().rpush(`player:${userId}:queue`, taskType);
    return { success: true, queueLength };
  }

  /**
   * 完成任务（无论玩家是否在线都会执行）
   * 返回：是否完成、奖励、是否在线（用于决定是否广播）
   */
  async completeTask(userId: bigint): Promise<{
    completed: boolean;
    reward: { itemId: string; count: number } | null;
    isOnline: boolean;
  }> {
    const now = Date.now();
    const current = await this.getCurrentTask(userId);

    if (!current) {
      return { completed: false, reward: null, isOnline: false };
    }

    const elapsed = now - current.startTime;
    const completed = Math.floor(elapsed / current.duration);

    if (completed < 1) {
      return { completed: false, reward: null, isOnline: false };
    }

    // 发放奖励（无论玩家是否在线）
    const config = getTaskConfig(current.type);
    if (!config) {
      throw new Error(`Unknown task type: ${current.type}`);
    }

    const rewardCount = completed * config.reward.count;
    await this.itemService.addItem(userId, config.reward.itemId, rewardCount);

    // 检查玩家是否在线
    const isOnline = await this.isPlayerOnline(userId);

    // 取下一个任务
    const nextTask = await this.redis.getClient().lpop(`player:${userId}:queue`);

    if (nextTask) {
      const nextConfig = getTaskConfig(nextTask);
      if (!nextConfig) {
        throw new Error(`Unknown task type: ${nextTask}`);
      }

      await this.redis.getClient().hset(`player:${userId}:current`, {
        type: nextTask,
        startTime: now.toString(),
        duration: nextConfig.duration.toString(),
      });

      await this.redis.getClient().zadd('production:active', now + nextConfig.duration, userId.toString());
    } else {
      await this.redis.getClient().del(`player:${userId}:current`);
      await this.redis.getClient().zrem('production:active', userId.toString());
    }

    return {
      completed: true,
      reward: { itemId: config.reward.itemId, count: rewardCount },
      isOnline,
    };
  }

  /**
   * 检查是否超过最大离线时间
   */
  async checkMaxOfflineTime(userId: bigint): Promise<{ shouldPause: boolean; lastOnline: number | null }> {
    const lastOnlineStr = await this.redis.getClient().get(`player:${userId}:lastOnline`);
    if (!lastOnlineStr) {
      return { shouldPause: false, lastOnline: null };
    }

    const lastOnline = parseInt(lastOnlineStr);
    const offlineDuration = Date.now() - lastOnline;
    const maxOfflineMs = MAX_OFFLINE_HOURS * 60 * 60 * 1000;

    return {
      shouldPause: offlineDuration > maxOfflineMs,
      lastOnline,
    };
  }

  /**
   * 玩家上线时调用
   */
  async onPlayerOnline(userId: bigint): Promise<void> {
    await this.redis.getClient().set(`player:${userId}:online`, '1');
    await this.redis.getClient().set(`player:${userId}:lastOnline`, Date.now().toString());
  }

  /**
   * 玩家下线时调用
   */
  async onPlayerOffline(userId: bigint): Promise<void> {
    await this.redis.getClient().del(`player:${userId}:online`);
    await this.redis.getClient().set(`player:${userId}:lastOnline`, Date.now().toString());
  }

  /**
   * 检查玩家是否在线
   */
  async isPlayerOnline(userId: bigint): Promise<boolean> {
    const online = await this.redis.getClient().get(`player:${userId}:online`);
    return online === '1';
  }

  private async getCurrentTask(userId: bigint): Promise<CurrentTask | null> {
    const key = `player:${userId}:current`;
    const data = await this.redis.getClient().hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      type: data.type,
      startTime: parseInt(data.startTime),
      duration: parseInt(data.duration),
    };
  }
}
