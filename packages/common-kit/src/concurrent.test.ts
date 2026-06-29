import { describe, it, expect } from 'vitest';
import { SimpleThreadExecutorRegion } from './concurrent/thread-executor-region.js';
import { DefaultExecutorRegion } from './concurrent/executor-region.js';

describe('SimpleThreadExecutorRegion', () => {
  it('rounds pool size up to power of two', () => {
    const region = new SimpleThreadExecutorRegion(3);
    // 3 -> next power of 2 is 4, mask is 3
    expect(region.getThreadExecutor(0)).toBe(region.getThreadExecutor(4));
    expect(region.getThreadExecutor(1)).toBe(region.getThreadExecutor(5));
  });

  it('distributes by hash via bitmask', () => {
    const region = new SimpleThreadExecutorRegion(4);
    const executor0 = region.getThreadExecutor(0);
    const executor1 = region.getThreadExecutor(1);
    expect(executor0).not.toBe(executor1);
    // 4 & 3 === 0, so same as index 0
    expect(region.getThreadExecutor(4)).toBe(executor0);
  });

  it('handles bigint index', () => {
    const region = new SimpleThreadExecutorRegion(4);
    const executor1 = region.getThreadExecutor(1);
    expect(region.getThreadExecutor(1n)).toBe(executor1);
  });

  it('executes tasks via microtask', async () => {
    const region = new SimpleThreadExecutorRegion(2);
    const executor = region.getThreadExecutor(0);
    let executed = false;
    executor.execute(() => {
      executed = true;
    });
    expect(executed).toBe(false);
    await new Promise((resolve) => {
      queueMicrotask(resolve);
    });
    expect(executed).toBe(true);
  });
});

describe('DefaultExecutorRegion', () => {
  it('provides user and simple executor regions', () => {
    const region = new DefaultExecutorRegion(4);
    expect(region.getUserThreadExecutorRegion()).toBeDefined();
    expect(region.getSimpleThreadExecutorRegion()).toBeDefined();
    expect(region.getUserThreadExecutor(0)).toBeDefined();
    expect(region.getSimpleThreadExecutor(0)).toBeDefined();
  });
});
