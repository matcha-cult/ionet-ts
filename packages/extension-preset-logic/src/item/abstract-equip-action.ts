import type { Attributes, Equipment, EquipSlot, UserId } from '../types/index.js';
import { userIdKey } from '../types/index.js';

/**
 * Template method for equipment loadouts: slot management, level gating, and
 * attribute aggregation. Concrete actions implement slot definitions and
 * attribute calculation.
 */
export abstract class AbstractEquipAction {
  private readonly equipped = new Map<string, Map<string, string>>();

  /** The equipment slots available to a user. */
  protected abstract getEquipSlots(userId: UserId): Promise<EquipSlot[]>;

  /** Aggregate attributes after applying all equipped items. */
  protected abstract calculateAttributes(userId: UserId): Promise<Attributes>;

  /** Invoked after a slot's item changes. Default no-op. */
  protected onEquipChanged(
    userId: UserId,
    slot: string,
    oldItemId: string | null,
    newItemId: string | null,
  ): void | Promise<void> {
    return undefined;
  }

  /** The user's current level, used to enforce level requirements. */
  protected async getUserLevel(userId: UserId): Promise<number> {
    return 1;
  }

  /** Load persisted slot->itemId mapping. Defaults to the in-memory store. */
  protected async loadEquipped(userId: UserId): Promise<ReadonlyMap<string, string>> {
    return this.equipped.get(userIdKey(userId)) ?? new Map<string, string>();
  }

  /** Persist slot->itemId mapping. Defaults to the in-memory store. */
  protected async saveEquipped(
    userId: UserId,
    equipped: ReadonlyMap<string, string>,
  ): Promise<void> {
    this.equipped.set(userIdKey(userId), new Map(equipped));
  }

  /** List slots with the currently equipped item filled in. */
  async listSlots(userId: UserId): Promise<EquipSlot[]> {
    const slots = await this.getEquipSlots(userId);
    const equipped = await this.loadEquipped(userId);
    return slots.map((slot) => ({ ...slot, currentItemId: equipped.get(slot.id) }));
  }

  async getEquipped(userId: UserId): Promise<ReadonlyMap<string, string>> {
    return this.loadEquipped(userId);
  }

  /** Equip an item, enforcing the slot exists and the level gate. */
  async equip(userId: UserId, item: Equipment): Promise<EquipSlot[]> {
    const level = await this.getUserLevel(userId);
    if (item.levelRequired > level) {
      throw new Error(
        'Level ' + item.levelRequired + ' required to equip (current level ' + level + ')',
      );
    }

    const slots = await this.getEquipSlots(userId);
    if (!slots.some((slot) => slot.id === item.slot)) {
      throw new Error('Unknown equip slot: ' + item.slot);
    }

    const equipped = new Map(await this.loadEquipped(userId));
    const old = equipped.get(item.slot) ?? null;
    equipped.set(item.slot, item.id);
    await this.saveEquipped(userId, equipped);
    await this.onEquipChanged(userId, item.slot, old, item.id);
    return this.listSlots(userId);
  }

  /** Unequip a slot, returning the removed item id (or null if empty). */
  async unequip(userId: UserId, slotId: string): Promise<string | null> {
    const equipped = new Map(await this.loadEquipped(userId));
    const old = equipped.get(slotId) ?? null;
    equipped.delete(slotId);
    await this.saveEquipped(userId, equipped);
    if (old !== null) {
      await this.onEquipChanged(userId, slotId, old, null);
    }
    return old;
  }

  async getAttributes(userId: UserId): Promise<Attributes> {
    return this.calculateAttributes(userId);
  }
}
