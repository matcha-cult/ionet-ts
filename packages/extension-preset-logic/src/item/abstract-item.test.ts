import { describe, it, expect } from 'vitest';
import { AbstractItem } from './abstract-item.js';
import type { Effect, Item, UseContext, UseResult } from '../types/index.js';

class HealingPotion extends AbstractItem {
  uses = 0;

  protected canUse(ctx: UseContext): boolean {
    return ctx.canUse !== false;
  }

  protected use(ctx: UseContext): UseResult {
    this.uses += 1;
    return { success: true };
  }

  protected getEffect(): Effect[] {
    return [{ attribute: 'hp', value: 50 }];
  }
}

describe('AbstractItem', () => {
  const base: Item = { id: 'potion', name: 'Potion', type: 'consumable', maxStack: 99 };

  it('uses an item and merges declared effects', async () => {
    const item = new HealingPotion(base);

    const result = await item.tryUse({ userId: 'u1' });

    expect(result.success).toBe(true);
    expect(result.effects).toEqual([{ attribute: 'hp', value: 50 }]);
    expect(item.uses).toBe(1);
  });

  it('rejects use when canUse returns false', async () => {
    const item = new HealingPotion(base);

    const result = await item.tryUse({ userId: 'u1', canUse: false });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Cannot use item');
    expect(item.uses).toBe(0);
  });

  it('enforces cooldown between successive uses', async () => {
    const item = new HealingPotion({ ...base, cooldownMs: 60_000 });

    const first = await item.tryUse({ userId: 'u1' });
    const second = await item.tryUse({ userId: 'u1' });

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.message).toBe('Item is on cooldown');
  });
});
