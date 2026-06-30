import { describe, it, expect } from 'vitest';
import { getInt, getLong, getBoolean, getString, size } from './safe-kit.js';

describe('SafeKit', () => {
  describe('getInt', () => {
    it('returns 0 for null/undefined', () => {
      expect(getInt(null)).toBe(0);
      expect(getInt(undefined)).toBe(0);
    });

    it('returns default for null with explicit default', () => {
      expect(getInt(null, 42)).toBe(42);
    });

    it('returns number value as-is', () => {
      expect(getInt(7)).toBe(7);
      expect(getInt(0)).toBe(0);
    });

    it('parses string to int', () => {
      expect(getInt('123', 0)).toBe(123);
    });

    it('returns default for unparseable string', () => {
      expect(getInt('abc', -1)).toBe(-1);
    });
  });

  describe('getLong', () => {
    it('returns 0n for null/undefined', () => {
      expect(getLong(null)).toBe(0n);
      expect(getLong(undefined)).toBe(0n);
    });

    it('returns bigint value as-is', () => {
      expect(getLong(100n)).toBe(100n);
    });

    it('parses string to bigint', () => {
      expect(getLong('999', 0n)).toBe(999n);
    });

    it('returns default for unparseable string', () => {
      expect(getLong('abc', -1n)).toBe(-1n);
    });
  });

  describe('getBoolean', () => {
    it('returns false for null', () => {
      expect(getBoolean(null)).toBe(false);
    });

    it('returns default for null', () => {
      expect(getBoolean(null, true)).toBe(true);
    });

    it('returns value as-is', () => {
      expect(getBoolean(true)).toBe(true);
      expect(getBoolean(false)).toBe(false);
    });
  });

  describe('getString', () => {
    it('returns default for null/empty', () => {
      expect(getString(null, 'fallback')).toBe('fallback');
      expect(getString(undefined, 'fallback')).toBe('fallback');
      expect(getString('', 'fallback')).toBe('fallback');
    });

    it('returns value as-is when non-empty', () => {
      expect(getString('hello', 'fallback')).toBe('hello');
    });
  });

  describe('size', () => {
    it('returns 0 for null/undefined', () => {
      expect(size(null)).toBe(0);
      expect(size(undefined)).toBe(0);
    });

    it('returns array length', () => {
      expect(size([1, 2, 3])).toBe(3);
      expect(size([])).toBe(0);
    });
  });
});
