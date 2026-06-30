import { describe, it, expect } from 'vitest';
import { CmdInfo } from './core/cmd-info.js';
import {
  FlowContext,
  createFlowContext,
  getCurrentFlowContext,
  runWithFlowContext,
  EmptyFlowContext,
  emptyFlowContext,
} from './core/flow/index.js';

describe('FlowContext', () => {
  it('get/set userId', () => {
    const ctx = new FlowContext();
    expect(ctx.getUserId()).toBe(0n);
    ctx.setUserId(12345n);
    expect(ctx.getUserId()).toBe(12345n);
  });

  it('bindingUserId is alias for setUserId', () => {
    const ctx = new FlowContext();
    ctx.bindingUserId(999n);
    expect(ctx.getUserId()).toBe(999n);
  });

  it('get/set cmdInfo', () => {
    const ctx = new FlowContext();
    const cmd = CmdInfo.of(1, 2);
    ctx.setCmdInfo(cmd);
    expect(ctx.getCmdInfo()).toBe(cmd);
    expect(ctx.getCmdMerge()).toBe(cmd.cmdMerge);
  });

  it('get/set request and response', () => {
    const ctx = new FlowContext();
    const req = { cmd: 1, subCmd: 2, data: 'test' };
    ctx.setRequest(req);
    expect(ctx.getRequest()).toBe(req);

    const res = { data: { result: 'ok' } };
    ctx.setResponse(res);
    expect(ctx.getResponse()).toBe(res);
  });

  it('error handling', () => {
    const ctx = new FlowContext();
    expect(ctx.hasError()).toBe(false);
    expect(ctx.getErrorCode()).toBe(0);

    ctx.setErrorCode(500);
    ctx.setErrorMessage('Internal Error');
    expect(ctx.hasError()).toBe(true);
    expect(ctx.getErrorCode()).toBe(500);
    expect(ctx.getErrorMessage()).toBe('Internal Error');
  });

  it('getNanoTime returns monotonic timestamp', () => {
    const ctx = new FlowContext();
    const t1 = ctx.getNanoTime();
    expect(t1).toBeGreaterThan(0n);
    const t2 = ctx.getNanoTime();
    expect(t2).toBe(t1);
  });
});

describe('FlowContext AsyncLocalStorage', () => {
  it('getCurrentFlowContext returns undefined outside runWithFlowContext', () => {
    expect(getCurrentFlowContext()).toBeUndefined();
  });

  it('getCurrentFlowContext returns context inside runWithFlowContext', () => {
    const ctx = createFlowContext({ userId: 100n });
    runWithFlowContext(ctx, () => {
      const current = getCurrentFlowContext();
      expect(current).toBe(ctx);
      expect(current!.getUserId()).toBe(100n);
    });
  });

  it('nested runWithFlowContext overrides outer context', () => {
    const outer = createFlowContext({ userId: 1n });
    const inner = createFlowContext({ userId: 2n });

    runWithFlowContext(outer, () => {
      expect(getCurrentFlowContext()!.getUserId()).toBe(1n);

      runWithFlowContext(inner, () => {
        expect(getCurrentFlowContext()!.getUserId()).toBe(2n);
      });

      expect(getCurrentFlowContext()!.getUserId()).toBe(1n);
    });
  });
});

describe('EmptyFlowContext', () => {
  it('has zero-valued cmdInfo', () => {
    expect(emptyFlowContext.getCmdMerge()).toBe(0);
  });

  it('is a singleton', () => {
    const ctx1 = new EmptyFlowContext();
    expect(ctx1).toBeInstanceOf(EmptyFlowContext);
  });
});

describe('createFlowContext', () => {
  it('creates context with options', () => {
    const cmd = CmdInfo.of(5, 10);
    const ctx = createFlowContext({ cmdInfo: cmd, userId: 42n });
    expect(ctx.getCmdInfo()).toBe(cmd);
    expect(ctx.getUserId()).toBe(42n);
  });

  it('creates context with defaults', () => {
    const ctx = createFlowContext();
    expect(ctx.getUserId()).toBe(0n);
    expect(ctx.getCmdMerge()).toBe(0);
  });
});
