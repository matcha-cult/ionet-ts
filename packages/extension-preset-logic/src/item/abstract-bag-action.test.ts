import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractBagAction } from './abstract-bag-action.js';
import type { UserId } from '../types/index.js';

class TestBagAction extends AbstractBagAction {
  events: string[] = [];
  size: number;

  constructor(size = 3) {
    super();
    this.size = size;
  }

  protected async getBagSize(userId: UserId): Promise<number> {
    return this.size;
  }

  protected async onItemAdded(userId: UserId, itemId: string, count: number): Promise<void> {
    this.events.push('add:' + itemId + ':' + count);
  }

  protected async onItemRemoved(userId: UserId, itemId: string, count: number): Promise<void> {
    this.events.push('remove:' + itemId + ':' + count);
  }
}

describe('AbstractBagAction', () => {
  let bag: TestBagAction;

  beforeEach(() => {
    bag = new TestBagAction();
  });

  it('adds and stacks items', async () => {
    await bag.add('u1', 'wood', 2);
    await bag.add('u1', 'wood', 3);

    expect(await bag.getCount('u1', 'wood')).toBe(5);
    expect(await bag.totalCount('u1')).toBe(5);
    expect(await bag.usedSlots('u1')).toBe(1);
    expect(await bag.list('u1')).toEqual([{ itemId: 'wood', count: 5 }]);
  });

  it('enforces capacity on new slots', async () => {
    const small = new TestBagAction(2);
    await small.add('u1', 'a', 1);
    await small.add('u1', 'b', 1);

    await expect(small.add('u1', 'c', 1)).rejects.toThrow('Bag is full');
  });

  it('removes items and empties exhausted slots', async () => {
    await bag.add('u1', 'wood', 5);

    expect(await bag.remove('u1', 'wood', 2)).toEqual({ itemId: 'wood', count: 3 });
    expect(await bag.remove('u1', 'wood', 3)).toBeNull();
    expect(await bag.getCount('u1', 'wood')).toBe(0);
  });

  it('rejects removing more than available', async () => {
    await bag.add('u1', 'wood', 1);
    await expect(bag.remove('u1', 'wood', 2)).rejects.toThrow('Not enough items');
  });

  it('fires add/remove hooks', async () => {
    await bag.add('u1', 'wood', 2);
    await bag.remove('u1', 'wood', 1);

    expect(bag.events).toEqual(['add:wood:2', 'remove:wood:1']);
  });
});
