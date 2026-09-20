import type { ItemStack, UserId } from '../types/index.js';
import { userIdKey } from '../types/index.js';

/**
 * Template method for inventory management: capacity checks, stacking, and
 * add/remove hooks. Concrete actions implement capacity and (optionally)
 * persistence via the load/save hooks.
 */
export abstract class AbstractBagAction {
  private readonly bags = new Map<string, Map<string, number>>();

  /** Maximum number of distinct item stacks this user's bag can hold. */
  protected abstract getBagSize(userId: UserId): Promise<number>;

  /** Invoked after an item stack grows. Default no-op. */
  protected onItemAdded(userId: UserId, itemId: string, count: number): void | Promise<void> {
    return undefined;
  }

  /** Invoked after an item stack shrinks. Default no-op. */
  protected onItemRemoved(userId: UserId, itemId: string, count: number): void | Promise<void> {
    return undefined;
  }

  /** Load persisted bag contents. Defaults to the in-memory store. */
  protected async loadBag(userId: UserId): Promise<ReadonlyMap<string, number>> {
    return this.bags.get(userIdKey(userId)) ?? new Map<string, number>();
  }

  /** Persist bag contents. Defaults to the in-memory store. */
  protected async saveBag(userId: UserId, bag: ReadonlyMap<string, number>): Promise<void> {
    this.bags.set(userIdKey(userId), new Map(bag));
  }

  async list(userId: UserId): Promise<ItemStack[]> {
    const bag = await this.loadBag(userId);
    return [...bag.entries()]
      .map(([itemId, count]) => ({ itemId, count }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));
  }

  async getCount(userId: UserId, itemId: string): Promise<number> {
    const bag = await this.loadBag(userId);
    return bag.get(itemId) ?? 0;
  }

  async usedSlots(userId: UserId): Promise<number> {
    const bag = await this.loadBag(userId);
    return bag.size;
  }

  async totalCount(userId: UserId): Promise<number> {
    const bag = await this.loadBag(userId);
    let total = 0;
    for (const count of bag.values()) total += count;
    return total;
  }

  /** Add items to the bag, enforcing capacity. Returns the updated stack. */
  async add(userId: UserId, itemId: string, count: number): Promise<ItemStack> {
    if (count <= 0) {
      throw new Error('count must be positive');
    }
    const bag = new Map(await this.loadBag(userId));
    const size = await this.getBagSize(userId);
    if (!bag.has(itemId) && bag.size >= size) {
      throw new Error('Bag is full');
    }
    const next = (bag.get(itemId) ?? 0) + count;
    bag.set(itemId, next);
    await this.saveBag(userId, bag);
    await this.onItemAdded(userId, itemId, count);
    return { itemId, count: next };
  }

  /** Remove items from the bag, enforcing availability. */
  async remove(userId: UserId, itemId: string, count: number): Promise<ItemStack | null> {
    if (count <= 0) {
      throw new Error('count must be positive');
    }
    const bag = new Map(await this.loadBag(userId));
    const current = bag.get(itemId) ?? 0;
    if (current < count) {
      throw new Error('Not enough items');
    }
    const next = current - count;
    if (next === 0) {
      bag.delete(itemId);
    } else {
      bag.set(itemId, next);
    }
    await this.saveBag(userId, bag);
    await this.onItemRemoved(userId, itemId, count);
    return next === 0 ? null : { itemId, count: next };
  }
}
