import type { Resource, Reward, UserId } from '../types/index.js';
import { userIdKey } from '../types/index.js';

export interface Battle {
  enemyId: string;
  durationMs: number;
  [key: string]: unknown;
}

/**
 * Template method for idle games: track online/offline transitions, cap
 * offline rewards, and delegate auto-battle + production to concrete actions.
 */
export abstract class AbstractIdleAction {
  private readonly lastSeenAt = new Map<string, number>();

  /** Compute the reward earned for a given offline duration. */
  protected abstract calculateOfflineReward(userId: UserId, offlineTimeMs: number): Promise<Reward>;

  /** Current resource production per unit of time. */
  protected abstract getResourceProduction(userId: UserId): Promise<Resource[]>;

  /** Process one automatic battle step. */
  protected abstract onAutoBattle(userId: UserId, battle: Battle): void | Promise<void>;

  /** Maximum offline duration eligible for rewards. Override to tune. */
  protected get maxOfflineRewardMs(): number {
    return 24 * 60 * 60 * 1000;
  }

  /** Current time. Overridable for deterministic testing. */
  protected now(): number {
    return Date.now();
  }

  /** Mark a user online; returns the offline duration since last seen. */
  async onPlayerOnline(userId: UserId): Promise<number> {
    const key = userIdKey(userId);
    const now = this.now();
    const last = this.lastSeenAt.get(key);
    this.lastSeenAt.set(key, now);
    return last === undefined ? 0 : Math.max(0, now - last);
  }

  async onPlayerOffline(userId: UserId): Promise<void> {
    this.lastSeenAt.set(userIdKey(userId), this.now());
  }

  /** Claim the offline reward, capped to {@link maxOfflineRewardMs}. */
  async claimOfflineReward(userId: UserId): Promise<Reward> {
    const offline = await this.onPlayerOnline(userId);
    const capped = Math.min(offline, this.maxOfflineRewardMs);
    if (capped <= 0) {
      return { items: [] };
    }
    return this.calculateOfflineReward(userId, capped);
  }

  async autoBattle(userId: UserId, battle: Battle): Promise<void> {
    await this.onAutoBattle(userId, battle);
  }

  async getProduction(userId: UserId): Promise<Resource[]> {
    return this.getResourceProduction(userId);
  }
}
