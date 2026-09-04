import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractUserAction } from './abstract-user-action.js';
import type { UserData, UserId } from '../types/index.js';
import { userIdKey } from '../types/index.js';

class TestUserAction extends AbstractUserAction {
  private readonly store = new Map<string, UserData>();
  levelUps: Array<{ old: number; next: number }> = [];

  protected async getUserData(userId: UserId): Promise<UserData> {
    const key = userIdKey(userId);
    const existing = this.store.get(key);
    if (existing) return existing;
    const data: UserData = {
      id: userId,
      nickname: 'User' + key,
      level: 1,
      exp: 0,
      currencies: {},
      createdAt: 0,
    };
    this.store.set(key, data);
    return data;
  }

  protected async saveUserData(userId: UserId, data: UserData): Promise<void> {
    this.store.set(userIdKey(userId), data);
  }

  protected async onLevelUp(user: UserData, oldLevel: number, newLevel: number): Promise<void> {
    this.levelUps.push({ old: oldLevel, next: newLevel });
  }
}

describe('AbstractUserAction', () => {
  let action: TestUserAction;

  beforeEach(() => {
    action = new TestUserAction();
  });

  it('creates and caches a user on first read', async () => {
    const user = await action.getUser('u1');

    expect(user.nickname).toBe('Useru1');
    expect(user.level).toBe(1);
  });

  it('adds exp and auto-levels', async () => {
    const user = await action.addExp('u1', 250);

    // level 1 needs 100, level 2 needs 200 => 250 becomes level 2 with 150 exp
    expect(user.level).toBe(2);
    expect(user.exp).toBe(150);
    expect(action.levelUps).toEqual([{ old: 1, next: 2 }]);
  });

  it('manages currency balances', async () => {
    await action.addCurrency('u1', 'gold', 100);
    await action.addCurrency('u1', 'gold', 50);

    let user = await action.getUser('u1');
    expect(user.currencies['gold']).toBe(150);

    await action.spendCurrency('u1', 'gold', 30);
    user = await action.getUser('u1');
    expect(user.currencies['gold']).toBe(120);
  });

  it('rejects overspending', async () => {
    await action.addCurrency('u1', 'gold', 10);
    await expect(action.spendCurrency('u1', 'gold', 11)).rejects.toThrow('Insufficient gold');
  });
});
