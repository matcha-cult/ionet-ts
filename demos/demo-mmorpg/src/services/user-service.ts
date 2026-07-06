import type { RedisClient } from '@nbb-ionet/redis';

export interface UserData {
  userId: bigint;
  nickname: string;
  level: number;
  exp: number;
  createdAt: number;
}

export class UserService {
  constructor(private redis: RedisClient) {}

  async getUserInfo(userId: bigint): Promise<UserData> {
    const key = `user:${userId}`;
    const data = await this.redis.getClient().hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      // Demo: 自动创建新用户
      return this.createUser(userId, `User${userId}`);
    }

    return {
      userId,
      nickname: data.nickname || `User${userId}`,
      level: parseInt(data.level || '1'),
      exp: parseInt(data.exp || '0'),
      createdAt: parseInt(data.createdAt || Date.now().toString()),
    };
  }

  async updateNickname(userId: bigint, nickname: string): Promise<boolean> {
    const key = `user:${userId}`;
    await this.redis.getClient().hset(key, 'nickname', nickname);
    return true;
  }

  async addExp(userId: bigint, exp: number): Promise<{ level: number; exp: number }> {
    const key = `user:${userId}`;
    const user = await this.getUserInfo(userId);

    user.exp += exp;

    // 升级逻辑：每 100 经验升一级
    while (user.exp >= user.level * 100) {
      user.exp -= user.level * 100;
      user.level++;
    }

    await this.redis.getClient().hset(key, {
      level: user.level.toString(),
      exp: user.exp.toString(),
    });

    return { level: user.level, exp: user.exp };
  }

  private async createUser(userId: bigint, nickname: string): Promise<UserData> {
    const key = `user:${userId}`;
    const userData: UserData = {
      userId,
      nickname,
      level: 1,
      exp: 0,
      createdAt: Date.now(),
    };

    await this.redis.getClient().hset(key, {
      nickname: userData.nickname,
      level: userData.level.toString(),
      exp: userData.exp.toString(),
      createdAt: userData.createdAt.toString(),
    });

    return userData;
  }
}
