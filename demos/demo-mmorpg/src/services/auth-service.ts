import jwt from 'jsonwebtoken';
import type { RedisClient } from '@nbb-ionet/redis';

const JWT_SECRET = 'demo-secret-key-change-in-production';
const TOKEN_EXPIRE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export class AuthService {
  constructor(private redis: RedisClient) {}

  async login(account: string, password: string): Promise<{ token: string; userId: bigint }> {
    // Demo: 硬编码验证，生产环境查数据库
    if (!account || !password) {
      throw new Error('Account and password required');
    }

    // Demo: 用 account 的 hashCode 作为 userId
    const userId = this.generateUserId(account);

    // 签发 JWT
    const token = jwt.sign({ userId: userId.toString(), account }, JWT_SECRET, {
      expiresIn: TOKEN_EXPIRE_SECONDS,
    });

    // Redis 存储 session
    await this.redis.getClient().set(
      `session:${token}`,
      JSON.stringify({ userId: userId.toString(), account, expireAt: Date.now() + TOKEN_EXPIRE_SECONDS * 1000 }),
      'EX',
      TOKEN_EXPIRE_SECONDS,
    );

    return { token, userId };
  }

  async verify(token: string): Promise<{ userId: bigint; account: string }> {
    const sessionData = await this.redis.getClient().get(`session:${token}`);
    if (!sessionData) {
      throw new Error('Invalid or expired token');
    }

    const session = JSON.parse(sessionData);
    return {
      userId: BigInt(session.userId),
      account: session.account,
    };
  }

  private generateUserId(account: string): bigint {
    let hash = 0;
    for (let i = 0; i < account.length; i++) {
      hash = (hash << 5) - hash + account.charCodeAt(i);
      hash |= 0;
    }
    return BigInt(Math.abs(hash));
  }
}
