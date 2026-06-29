import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { FlowContext } from './core/flow/flow-context.js';
import { InMemorySessionStore, DefaultSessionManager } from './core/flow/session.js';
import { SessionInOut } from './core/flow/internal/session-inout.js';
import { AccessLogInOut } from './core/flow/internal/access-log-inout.js';
import { RateLimitInOut } from './core/flow/internal/rate-limit-inout.js';

describe('SessionInOut', () => {
  it('restores userId from session', async () => {
    const store = new InMemorySessionStore();
    const manager = new DefaultSessionManager(store);
    const inOut = new SessionInOut(manager);

    const ctx = new FlowContext();
    ctx.setRequest({ cmd: 1, subCmd: 1, data: null });

    await manager.saveSession(ctx, { userId: 999n, createdAt: Date.now() });

    const newCtx = new FlowContext();
    newCtx.setRequest(ctx.getRequest());
    await inOut.fuckIn(newCtx);

    expect(newCtx.getUserId()).toBe(999n);
  });

  it('saves userId to session on fuckOut', async () => {
    const store = new InMemorySessionStore();
    const manager = new DefaultSessionManager(store);
    const inOut = new SessionInOut(manager);

    const ctx = new FlowContext();
    ctx.setRequest({ cmd: 1, subCmd: 1, data: null });
    ctx.setSession({ userId: 0n, createdAt: Date.now() });
    ctx.setUserId(888n);

    await inOut.fuckOut(ctx);

    const session = await manager.getSession(ctx);
    expect(session!.userId).toBe(888n);
  });
});

describe('AccessLogInOut', () => {
  it('logs request info', () => {
    const logs: string[] = [];
    const inOut = new AccessLogInOut({ printer: (msg) => logs.push(msg) });

    const ctx = new FlowContext();
    ctx.setCmdInfo({ cmd: 1, subCmd: 2, cmdMerge: 65538 } as any);
    ctx.setUserId(123n);
    ctx.setServer({ id: 'http-1', type: 'http', port: 8080, host: 'localhost' });

    inOut.fuckIn(ctx);
    inOut.fuckOut(ctx);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('1-2');
    expect(logs[0]).toContain('user=123');
    expect(logs[0]).toContain('http:8080');
  });

  it('supports custom format', () => {
    const logs: string[] = [];
    const inOut = new AccessLogInOut({
      printer: (msg) => logs.push(msg),
      customFormat: (ctx, ms) => `CUSTOM: cmd=${ctx.getCmdMerge()} time=${ms}ms`,
    });

    const ctx = new FlowContext();
    ctx.setCmdInfo({ cmd: 5, subCmd: 10, cmdMerge: 327690 } as any);

    inOut.fuckIn(ctx);
    inOut.fuckOut(ctx);

    expect(logs[0]).toMatch(/CUSTOM: cmd=\d+ time=[\d.]+ms/);
  });
});

describe('RateLimitInOut', () => {
  it('allows requests under limit', () => {
    const inOut = new RateLimitInOut({ maxRequests: 3, windowMs: 1000 });

    for (let i = 0; i < 3; i++) {
      const ctx = new FlowContext();
      ctx.setUserId(BigInt(i));
      inOut.fuckIn(ctx);
      expect(ctx.hasError()).toBe(false);
    }
  });

  it('blocks requests over limit', () => {
    const inOut = new RateLimitInOut({ maxRequests: 2, windowMs: 1000 });

    const ctx1 = new FlowContext();
    ctx1.setUserId(100n);
    inOut.fuckIn(ctx1);
    expect(ctx1.hasError()).toBe(false);

    const ctx2 = new FlowContext();
    ctx2.setUserId(100n);
    inOut.fuckIn(ctx2);
    expect(ctx2.hasError()).toBe(false);

    const ctx3 = new FlowContext();
    ctx3.setUserId(100n);
    inOut.fuckIn(ctx3);
    expect(ctx3.hasError()).toBe(true);
    expect(ctx3.getErrorCode()).toBe(429);
  });

  it('different users have independent limits', () => {
    const inOut = new RateLimitInOut({ maxRequests: 1, windowMs: 1000 });

    const ctx1 = new FlowContext();
    ctx1.setUserId(1n);
    inOut.fuckIn(ctx1);

    const ctx2 = new FlowContext();
    ctx2.setUserId(2n);
    inOut.fuckIn(ctx2);

    expect(ctx1.hasError()).toBe(false);
    expect(ctx2.hasError()).toBe(false);
  });

  it('getStats returns correct counts', () => {
    const inOut = new RateLimitInOut({ maxRequests: 5, windowMs: 1000 });

    const ctx = new FlowContext();
    ctx.setUserId(42n);
    inOut.fuckIn(ctx);

    const stats = inOut.getStats('42');
    expect(stats.count).toBe(1);
    expect(stats.remaining).toBe(4);
  });

  it('calls onLimitExceeded callback', () => {
    const exceeded = vi.fn();
    const inOut = new RateLimitInOut({
      maxRequests: 1,
      windowMs: 1000,
      onLimitExceeded: exceeded,
    });

    const ctx1 = new FlowContext();
    ctx1.setUserId(1n);
    inOut.fuckIn(ctx1);

    const ctx2 = new FlowContext();
    ctx2.setUserId(1n);
    inOut.fuckIn(ctx2);

    expect(exceeded).toHaveBeenCalledWith(ctx2);
  });
});
