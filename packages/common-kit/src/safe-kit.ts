export function getInt(value: number | null | undefined): number;
export function getInt(value: number | null | undefined, defaultValue: number): number;
export function getInt(value: string, defaultValue: number): number;
export function getInt(
  value: number | string | null | undefined,
  defaultValue = 0,
): number {
  if (value == null) return defaultValue;
  if (typeof value === 'number') return value;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function getLong(value: bigint | null | undefined): bigint;
export function getLong(value: bigint | null | undefined, defaultValue: bigint): bigint;
export function getLong(value: string, defaultValue: bigint): bigint;
export function getLong(
  value: bigint | string | null | undefined,
  defaultValue: bigint = 0n,
): bigint {
  if (value == null) return defaultValue;
  if (typeof value === 'bigint') return value;
  try {
    return BigInt(value);
  } catch {
    return defaultValue;
  }
}

export function getBoolean(
  value: boolean | null | undefined,
  defaultValue = false,
): boolean {
  return value == null ? defaultValue : value;
}

export function getString(
  value: string | null | undefined,
  defaultValue: string,
): string {
  return value == null || value === '' ? defaultValue : value;
}

export function size<T>(list: readonly T[] | null | undefined): number {
  return list == null ? 0 : list.length;
}
