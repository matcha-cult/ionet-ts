import type { RedisClient } from '@nbb-ionet/redis';

export interface BagItem {
  itemId: string;
  count: number;
}

export class ItemService {
  constructor(private redis: RedisClient) {}

  async getBag(userId: bigint): Promise<BagItem[]> {
    const key = `bag:${userId}`;
    const data = await this.redis.getClient().hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return [];
    }

    return Object.entries(data).map(([itemId, count]) => ({
      itemId,
      count: parseInt(count),
    }));
  }

  async addItem(userId: bigint, itemId: string, count: number): Promise<boolean> {
    const key = `bag:${userId}`;
    await this.redis.getClient().hincrby(key, itemId, count);
    return true;
  }

  async removeItem(userId: bigint, itemId: string, count: number): Promise<boolean> {
    const key = `bag:${userId}`;
    const currentCount = parseInt((await this.redis.getClient().hget(key, itemId)) || '0');

    if (currentCount < count) {
      throw new Error(`Not enough ${itemId}: have ${currentCount}, need ${count}`);
    }

    await this.redis.getClient().hincrby(key, itemId, -count);

    // 如果数量为 0，删除该字段
    if (currentCount === count) {
      await this.redis.getClient().hdel(key, itemId);
    }

    return true;
  }

  async useItem(userId: bigint, itemId: string, count: number): Promise<{ success: boolean; effect: any }> {
    await this.removeItem(userId, itemId, count);

    // Demo: 简单的使用效果
    return {
      success: true,
      effect: {
        type: 'consume',
        itemId,
        count,
      },
    };
  }
}
