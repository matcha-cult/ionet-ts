import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ActionController, ActionMethod } from './decorators/action-decorators.js';
import { BarSkeletonBuilder } from './core/bar-skeleton.js';
import { DebugInOut } from './core/flow/internal/debug-inout.js';
import { StatActionInOut } from './core/flow/internal/stat-action-inout.js';
import { InOutChain, type ActionMethodInOut } from './core/flow/action-method-inout.js';
import { type FlowContext } from './core/flow/flow-context.js';

const HALL_CMD = { cmd: 1, loginVerify: 1, hello: 2 } as const;

@ActionController(HALL_CMD.cmd)
class HallAction {
  @ActionMethod(HALL_CMD.loginVerify)
  login(jwt: string): { id: number; nickname: string } {
    return { id: 12345, nickname: jwt };
  }

  @ActionMethod(HALL_CMD.hello)
  hello(name: string): string {
    return `hello ${name}`;
  }
}

describe('InOutChain', () => {
  it('executes inOuts in order', () => {
    const order: string[] = [];
    const chain = new InOutChain();
    chain.add({
      fuckIn: () => order.push('A-in'),
      fuckOut: () => order.push('A-out'),
    });
    chain.add({
      fuckIn: () => order.push('B-in'),
      fuckOut: () => order.push('B-out'),
    });

    const ctx = { getCmdInfo: () => ({ cmd: 1, subCmd: 1, cmdMerge: 65537 }) } as unknown as FlowContext;
    chain.fuckInAll(ctx);
    chain.fuckOutAll(ctx);

    expect(order).toEqual(['A-in', 'B-in', 'A-out', 'B-out']);
  });
});

describe('DebugInOut', () => {
  it('logs request and result', async () => {
    const logs: string[] = [];
    const debugInOut = new DebugInOut({
      printer: (msg) => logs.push(msg),
    });

    const skeleton = new BarSkeletonBuilder()
      .addAction(HallAction)
      .addInOut(debugInOut)
      .build();

    await skeleton.execute({
      cmd: HALL_CMD.cmd,
      subCmd: HALL_CMD.loginVerify,
      data: 'Alice',
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('cmd=1');
    expect(logs[0]).toContain('subCmd=1');
    expect(logs[0]).toContain('Alice');
  });

  it('logs error when action throws', async () => {
    @ActionController(10)
    class ErrorAction {
      @ActionMethod(1)
      fail(): never {
        throw new Error('test error');
      }
    }

    const logs: string[] = [];
    const skeleton = new BarSkeletonBuilder()
      .addAction(ErrorAction)
      .addInOut(new DebugInOut({ printer: (msg) => logs.push(msg) }))
      .build();

    await skeleton.execute({ cmd: 10, subCmd: 1, data: null });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('Error');
    expect(logs[0]).toContain('500');
  });
});

describe('StatActionInOut', () => {
  it('tracks call statistics', async () => {
    const statInOut = new StatActionInOut();
    const skeleton = new BarSkeletonBuilder()
      .addAction(HallAction)
      .addInOut(statInOut)
      .build();

    await skeleton.execute({ cmd: 1, subCmd: 1, data: 'A' });
    await skeleton.execute({ cmd: 1, subCmd: 1, data: 'B' });
    await skeleton.execute({ cmd: 1, subCmd: 2, data: 'C' });

    const stats = statInOut.getStats();
    expect(stats).toHaveLength(2);

    const stat1 = statInOut.getStat((1 << 16) | 1);
    expect(stat1).toBeDefined();
    expect(stat1!.count).toBe(2);
    expect(stat1!.errorCount).toBe(0);

    const stat2 = statInOut.getStat((1 << 16) | 2);
    expect(stat2).toBeDefined();
    expect(stat2!.count).toBe(1);
  });
});

describe('BarSkeletonBuilder with InOut', () => {
  it('addInOut returns builder for chaining', () => {
    const builder = new BarSkeletonBuilder();
    const result = builder.addInOut(new DebugInOut());
    expect(result).toBe(builder);
  });

  it('multiple inOuts execute in registration order', async () => {
    const order: string[] = [];
    const inOut1: ActionMethodInOut = {
      fuckIn: () => order.push('1-in'),
      fuckOut: () => order.push('1-out'),
    };
    const inOut2: ActionMethodInOut = {
      fuckIn: () => order.push('2-in'),
      fuckOut: () => order.push('2-out'),
    };

    const skeleton = new BarSkeletonBuilder()
      .addAction(HallAction)
      .addInOut(inOut1)
      .addInOut(inOut2)
      .build();

    await skeleton.execute({ cmd: 1, subCmd: 1, data: 'test' });

    expect(order).toEqual(['1-in', '2-in', '1-out', '2-out']);
  });
});
