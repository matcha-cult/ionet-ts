import { describe, it, expect } from 'vitest';
import { CoreGlobalConfig, setNetId, getFutureTimeoutMillis } from './global-config.js';

describe('CoreGlobalConfig', () => {
  it('has default values', () => {
    expect(CoreGlobalConfig.netId).toBeGreaterThanOrEqual(1000);
    expect(CoreGlobalConfig.timeoutMillis).toBe(3000);
    expect(CoreGlobalConfig.cleanFrequency).toBe(10_000);
    expect(CoreGlobalConfig.netPubName).toBe(String(CoreGlobalConfig.netId));
  });

  it('setNetId updates netId and netPubName', () => {
    setNetId(2000);
    expect(CoreGlobalConfig.netId).toBe(2000);
    expect(CoreGlobalConfig.netPubName).toBe('2000');
  });

  it('setNetId throws for values < 1000', () => {
    expect(() => setNetId(999)).toThrow(RangeError);
  });

  it('getFutureTimeoutMillis adds 200ms buffer', () => {
    expect(getFutureTimeoutMillis()).toBe(CoreGlobalConfig.timeoutMillis + 200);
  });
});
