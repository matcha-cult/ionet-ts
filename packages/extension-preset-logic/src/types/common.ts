/**
 * Shared primitives used across every preset-logic module.
 *
 * IDs in this package are intentionally storage-agnostic: the framework's
 * FlowContext.getUserId returns a bigint, while most persistence backends
 * (Redis keys, JSON documents) prefer string. Accept both and normalize to a
 * stable string key via userIdKey.
 */
export type UserId = string | bigint;

/** Normalize a user/account/role id to a stable string key for storage. */
export function userIdKey(id: UserId): string {
  return typeof id === 'bigint' ? id.toString() : id;
}

/** A single produced/consumed resource entry (e.g. gold, exp, item). */
export interface Resource {
  id: string;
  count: number;
}

/** A collection of resource deltas used by reward/production flows. */
export interface Reward {
  items: Resource[];
  currencies?: Record<string, number>;
}
