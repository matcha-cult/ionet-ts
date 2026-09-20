import type { UserId } from './common.js';

/** Minimal authenticated-user identity returned by auth flows. */
export interface UserInfo {
  id: UserId;
  nickname: string;
  username?: string;
  /** Free-form extension point (avatar url, platform, etc.). */
  [key: string]: unknown;
}

/**
 * Persisted player/account state backing UserInfo. Concrete implementations
 * decide how this maps to storage.
 */
export interface UserData extends UserInfo {
  level: number;
  exp: number;
  /** Currency balances, e.g. { gold: 100, gem: 5 }. */
  currencies: Record<string, number>;
  createdAt: number;
}

/** A participant inside a room (see the room module). */
export interface Player {
  id: UserId;
  name: string;
  seat?: number;
  metadata?: Record<string, unknown>;
}

/** A selectable character under one account. */
export interface Role {
  id: UserId;
  accountId: UserId;
  name: string;
  level: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export const DEFAULT_EXP_PER_LEVEL = 100;
