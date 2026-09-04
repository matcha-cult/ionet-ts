import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractEquipAction } from './abstract-equip-action.js';
import type { Attributes, Equipment, EquipSlot, UserId } from '../types/index.js';

const sword: Equipment = {
  id: 'sword',
  name: 'Sword',
  type: 'equipment',
  maxStack: 1,
  slot: 'weapon',
  levelRequired: 1,
  attributes: [{ attribute: 'attack', value: 10 }],
};

class TestEquipAction extends AbstractEquipAction {
  events: string[] = [];
  level: number;

  constructor(level = 1) {
    super();
    this.level = level;
  }

  protected async getEquipSlots(userId: UserId): Promise<EquipSlot[]> {
    return [
      { id: 'weapon', label: 'Weapon' },
      { id: 'armor', label: 'Armor' },
    ];
  }

  protected async calculateAttributes(userId: UserId): Promise<Attributes> {
    const equipped = await this.getEquipped(userId);
    return {
      attack: equipped.has('weapon') ? 10 : 0,
      defense: equipped.has('armor') ? 5 : 0,
    };
  }

  protected async getUserLevel(userId: UserId): Promise<number> {
    return this.level;
  }

  protected async onEquipChanged(
    userId: UserId,
    slot: string,
    oldItemId: string | null,
    newItemId: string | null,
  ): Promise<void> {
    this.events.push(slot + ':' + oldItemId + '->' + newItemId);
  }
}

describe('AbstractEquipAction', () => {
  let equip: TestEquipAction;

  beforeEach(() => {
    equip = new TestEquipAction();
  });

  it('equips an item into a slot and reflects it in listSlots', async () => {
    const slots = await equip.equip('u1', sword);

    expect(slots.find((slot) => slot.id === 'weapon')?.currentItemId).toBe('sword');
    expect(await equip.getEquipped('u1')).toEqual(new Map([['weapon', 'sword']]));
    expect(await equip.getAttributes('u1')).toEqual({ attack: 10, defense: 0 });
  });

  it('rejects equipping above the user level', async () => {
    const lowLevel = new TestEquipAction(1);
    await expect(lowLevel.equip('u1', { ...sword, levelRequired: 5 })).rejects.toThrow(
      'Level 5 required',
    );
  });

  it('rejects unknown slots', async () => {
    await expect(equip.equip('u1', { ...sword, slot: 'trinket' })).rejects.toThrow(
      'Unknown equip slot',
    );
  });

  it('unequips and restores the previous state', async () => {
    await equip.equip('u1', sword);

    const removed = await equip.unequip('u1', 'weapon');

    expect(removed).toBe('sword');
    expect(await equip.getEquipped('u1')).toEqual(new Map());
  });

  it('fires onEquipChanged hooks', async () => {
    await equip.equip('u1', sword);
    await equip.unequip('u1', 'weapon');

    expect(equip.events).toEqual(['weapon:null->sword', 'weapon:sword->null']);
  });
});
