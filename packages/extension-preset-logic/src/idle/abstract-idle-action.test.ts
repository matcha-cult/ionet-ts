import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractIdleAction, type Battle } from './abstract-idle-action.js';
import type { Resource, Reward, UserId } from '../types/index.js';

class TestIdleAction extends AbstractIdleAction {
  clock = 0;
  autoBattles: Battle[] = [];
  rewards: number[] = [];
  productionOutput: Resource[] = [{ id: 'gold', count: 5 }];

  protected now(): number {
    return this.clock;
  }

  protected get maxOfflineRewardMs(): number {
    return 60 * 60 * 1000;
  }

  protected async calculateOfflineReward(userId: UserId, offlineTimeMs: number): Promise<Reward> {
    this.rewards.push(offlineTimeMs);
    return { items: [{ id: 'gold', count: Math.floor(offlineTimeMs / 1000) }] };
  }

  protected async getResourceProduction(userId: UserId): Promise<Resource[]> {
    return this.productionOutput;
  }

  protected async onAutoBattle(userId: UserId, battle: Battle): Promise<void> {
    this.autoBattles.push(battle);
  }
}

describe('AbstractIdleAction', () => {
  let idle: TestIdleAction;

  beforeEach(() => {
    idle = new TestIdleAction();
  });

  it('returns an empty reward when there is no offline time', async () => {
    expect(await idle.claimOfflineReward('u1')).toEqual({ items: [] });
  });

  it('computes offline reward from the elapsed offline time', async () => {
    await idle.onPlayerOffline('u1');
    idle.clock = 5000;

    const reward = await idle.claimOfflineReward('u1');

    expect(reward).toEqual({ items: [{ id: 'gold', count: 5 }] });
    expect(idle.rewards).toEqual([5000]);
  });

  it('caps offline rewards to the configured maximum', async () => {
    await idle.onPlayerOffline('u1');
    idle.clock = 2 * 60 * 60 * 1000; // two hours, cap is one hour

    const reward = await idle.claimOfflineReward('u1');

    expect(reward).toEqual({ items: [{ id: 'gold', count: 3600 }] });
    expect(idle.rewards).toEqual([60 * 60 * 1000]);
  });

  it('delegates auto-battle and production', async () => {
    const battle: Battle = { enemyId: 'goblin', durationMs: 1000 };
    await idle.autoBattle('u1', battle);

    expect(idle.autoBattles).toEqual([battle]);
    expect(await idle.getProduction('u1')).toEqual([{ id: 'gold', count: 5 }]);
  });
});
