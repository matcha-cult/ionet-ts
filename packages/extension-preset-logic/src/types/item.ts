import type { UserId } from './common.js';

/** A single attribute delta produced by item use or equipment. */
export interface Effect {
  /** Attribute key, e.g. hp, attack, exp, gold. */
  attribute: string;
  value: number;
  [key: string]: unknown;
}

/** Definition of an item (immutable, catalog-level). */
export interface Item {
  id: string;
  name: string;
  /** consumable | equipment | material | any domain tag. */
  type: string;
  /** Maximum stack size for stackable items. */
  maxStack: number;
  effects?: Effect[];
  /** Per-user cooldown in milliseconds, when applicable. */
  cooldownMs?: number;
  [key: string]: unknown;
}

/** An owned stack of an item inside a bag. */
export interface ItemStack {
  itemId: string;
  count: number;
}

/** Context passed to item use decisions. */
export interface UseContext {
  userId: UserId;
  [key: string]: unknown;
}

export interface UseResult {
  success: boolean;
  effects?: Effect[];
  message?: string;
}

/** Equipment is an item that can occupy a slot and grant attributes. */
export interface Equipment extends Item {
  type: 'equipment';
  slot: string;
  levelRequired: number;
  attributes?: Effect[];
}

export interface EquipSlot {
  id: string;
  label: string;
  currentItemId?: string;
}

/** Aggregated attributes after equipment resolution. */
export type Attributes = Record<string, number>;
