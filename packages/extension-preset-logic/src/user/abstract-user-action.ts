import type { UserData, UserId } from '../types/index.js';
import { DEFAULT_EXP_PER_LEVEL, userIdKey } from '../types/index.js';

/**
 * Template method for user profile persistence: caching, level/exp math, and
 * currency balance management. Concrete actions implement storage via
 * {@link getUserData} / {@link saveUserData}.
 */
export abstract class AbstractUserAction {
  private readonly cache = new Map<string, UserData>();

  /** Load persisted user data, creating a default record when missing. */
  protected abstract getUserData(userId: UserId): Promise<UserData>;

  /** Persist user data. */
  protected abstract saveUserData(userId: UserId, data: UserData): Promise<void>;

  /** Invoked after a level up. Default no-op. */
  protected onLevelUp(user: UserData, oldLevel: number, newLevel: number): void | Promise<void> {
    return undefined;
  }

  /** Exp required to advance from the given level. Override for custom curves. */
  protected expRequiredForLevel(level: number): number {
    return level * DEFAULT_EXP_PER_LEVEL;
  }

  /** Fetch user data with an in-memory cache, deferring to {@link getUserData}. */
  async getUser(userId: UserId): Promise<UserData> {
    const key = userIdKey(userId);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const data = await this.getUserData(userId);
    this.cache.set(key, data);
    return data;
  }

  async updateNickname(userId: UserId, nickname: string): Promise<UserData> {
    const user = await this.getUser(userId);
    user.nickname = nickname;
    await this.persist(userId, user);
    return user;
  }

  /** Add exp and auto-level the user; fires {@link onLevelUp} per promotion. */
  async addExp(userId: UserId, exp: number): Promise<UserData> {
    const user = await this.getUser(userId);
    if (exp <= 0) return user;

    user.exp += exp;
    const oldLevel = user.level;
    while (user.exp >= this.expRequiredForLevel(user.level)) {
      user.exp -= this.expRequiredForLevel(user.level);
      user.level += 1;
    }

    if (user.level > oldLevel) {
      await this.onLevelUp(user, oldLevel, user.level);
    }
    await this.persist(userId, user);
    return user;
  }

  async addCurrency(userId: UserId, currency: string, amount: number): Promise<UserData> {
    const user = await this.getUser(userId);
    this.ensureCurrencies(user);
    user.currencies[currency] = (user.currencies[currency] ?? 0) + amount;
    await this.persist(userId, user);
    return user;
  }

  /** Spend currency; throws when the balance is insufficient. */
  async spendCurrency(userId: UserId, currency: string, amount: number): Promise<UserData> {
    const user = await this.getUser(userId);
    this.ensureCurrencies(user);
    const balance = user.currencies[currency] ?? 0;
    if (balance < amount) {
      throw new Error('Insufficient ' + currency + ': have ' + balance + ', need ' + amount);
    }
    user.currencies[currency] = balance - amount;
    await this.persist(userId, user);
    return user;
  }

  /** Force persistence of a (possibly modified) cached user record. */
  async save(userId: UserId): Promise<void> {
    await this.persist(userId, await this.getUser(userId));
  }

  protected async persist(userId: UserId, data: UserData): Promise<void> {
    this.cache.set(userIdKey(userId), data);
    await this.saveUserData(userId, data);
  }

  protected clearCache(userId: UserId): void {
    this.cache.delete(userIdKey(userId));
  }

  private ensureCurrencies(user: UserData): void {
    if (!user.currencies) user.currencies = {};
  }
}
