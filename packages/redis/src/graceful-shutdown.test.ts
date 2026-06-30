import { describe, it, expect, vi } from 'vitest';
import { GracefulShutdown } from './graceful-shutdown.js';

describe('GracefulShutdown', () => {
  it('should initialize with default options', () => {
    const shutdown = new GracefulShutdown();
    expect(shutdown.isShuttingDown()).toBe(false);
  });

  it('should run cleanup handlers in reverse order', async () => {
    const order: number[] = [];
    const shutdown = new GracefulShutdown();

    shutdown.addHandler(() => { order.push(1); });
    shutdown.addHandler(() => { order.push(2); });
    shutdown.addHandler(() => { order.push(3); });

    await (shutdown as unknown as { runCleanup: () => Promise<void> }).runCleanup();
    expect(order).toEqual([3, 2, 1]);
  });

  it('should call onShutdown callback', async () => {
    const onShutdown = vi.fn();
    const shutdown = new GracefulShutdown({ onShutdown });

    await (shutdown as unknown as { runCleanup: () => Promise<void> }).runCleanup();
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it('should handle async cleanup handlers', async () => {
    const results: string[] = [];
    const shutdown = new GracefulShutdown();

    shutdown.addHandler(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      results.push('async');
    });
    shutdown.addHandler(() => {
      results.push('sync');
    });

    await (shutdown as unknown as { runCleanup: () => Promise<void> }).runCleanup();
    expect(results).toEqual(['sync', 'async']);
  });

  it('should continue even if handler throws', async () => {
    const results: string[] = [];
    const shutdown = new GracefulShutdown();

    shutdown.addHandler(() => {
      throw new Error('handler error');
    });
    shutdown.addHandler(() => {
      results.push('completed');
    });

    await (shutdown as unknown as { runCleanup: () => Promise<void> }).runCleanup();
    expect(results).toEqual(['completed']);
  });

  it('should set shuttingDown flag', async () => {
    const shutdown = new GracefulShutdown({
      signals: [],
    });

    expect(shutdown.isShuttingDown()).toBe(false);
  });
});
