import type { Effect, Item, UseContext, UseResult } from '../types/index.js';
import { userIdKey } from '../types/index.js';

/**
 * Base class for an item definition: wraps catalog data and provides the
 * use flow (cooldown check, permission check, effect resolution).
 */
export abstract class AbstractItem {
  private readonly lastUsedAt = new Map<string, number>();

  constructor(protected readonly definition: Item) {}

  get id(): string {
    return this.definition.id;
  }

  get name(): string {
    return this.definition.name;
  }

  get type(): string {
    return this.definition.type;
  }

  get maxStack(): number {
    return this.definition.maxStack ?? 1;
  }

  get cooldownMs(): number {
    return this.definition.cooldownMs ?? 0;
  }

  /** Whether the item can be used right now (beyond cooldown). */
  protected abstract canUse(context: UseContext): boolean | Promise<boolean>;

  /** Apply the item effect. */
  protected abstract use(context: UseContext): UseResult | Promise<UseResult>;

  /** Compute the item effect. Defaults to the statically declared effects. */
  protected getEffect(context: UseContext): Effect[] | Promise<Effect[]> {
    return this.definition.effects ?? [];
  }

  /** Cooldown + canUse + use orchestration, merging effects into the result. */
  async tryUse(context: UseContext): Promise<UseResult> {
    const key = userIdKey(context.userId);
    const now = Date.now();

    if (this.cooldownMs > 0) {
      const last = this.lastUsedAt.get(key);
      if (last !== undefined && now - last < this.cooldownMs) {
        return { success: false, message: 'Item is on cooldown' };
      }
    }

    const allowed = await this.canUse(context);
    if (!allowed) {
      return { success: false, message: 'Cannot use item' };
    }

    const result = await this.use(context);
    if (result.success) {
      if (this.cooldownMs > 0) {
        this.lastUsedAt.set(key, now);
      }
      if (!result.effects) {
        result.effects = await this.getEffect(context);
      }
    }
    return result;
  }
}
