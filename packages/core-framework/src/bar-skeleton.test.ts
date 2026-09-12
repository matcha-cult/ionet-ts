import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ActionController, ActionMethod } from './decorators/action-decorators.js';
import { BarSkeleton, BarSkeletonBuilder } from './core/bar-skeleton.js';
import { FlowContext } from './core/flow/flow-context.js';
import { type ActionMethodInOut } from './core/flow/action-method-inout.js';

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

  @ActionMethod(3)
  withContext(data: string): string {
    return `data=${data}`;
  }
}

describe('BarSkeleton', () => {
  it('execute invokes action and returns result', async () => {
    const skeleton = new BarSkeletonBuilder()
      .addAction(HallAction)
      .build();

    const response = await skeleton.execute({
      cmd: HALL_CMD.cmd,
      subCmd: HALL_CMD.loginVerify,
      data: 'Alice',
    });

    expect(response.errorCode).toBeUndefined();
    expect(response.data).toEqual({ id: 12345, nickname: 'Alice' });
  });

  it('execute returns 404 for unknown action', async () => {
    const skeleton = new BarSkeletonBuilder()
      .addAction(HallAction)
      .build();

    const response = await skeleton.execute({
      cmd: 999,
      subCmd: 999,
      data: null,
    });

    expect(response.errorCode).toBe(404);
    expect(response.errorMessage).toContain('Action not found');
  });

  it('execute handles action errors', async () => {
    @ActionController(10)
    class ErrorAction {
      @ActionMethod(1)
      throwError(): never {
        throw new Error('Test error');
      }
    }

    const skeleton = new BarSkeletonBuilder()
      .addAction(ErrorAction)
      .build();

    const response = await skeleton.execute({
      cmd: 10,
      subCmd: 1,
      data: null,
    });

    expect(response.errorCode).toBe(500);
    expect(response.errorMessage).toBe('Test error');
  });

  it('execute can access FlowContext via ALS', async () => {
    const skeleton = new BarSkeletonBuilder()
      .addAction(HallAction)
      .build();

    const response = await skeleton.execute({
      cmd: HALL_CMD.cmd,
      subCmd: 3,
      data: 'test-data',
    });

    expect(response.data).toBe('data=test-data');
  });
});

describe('BarSkeleton execute hooks（任务 1）', () => {
  @ActionController(20)
  class HookAction {
    @ActionMethod(1)
    echo(data: string): string {
      return `echo:${data}`;
    }

    @ActionMethod(2)
    fail(): never {
      throw new Error('boom');
    }
  }

  /**
   * 模拟 WsAuthInOut：从 request.data 取 userId 并绑定到 FlowContext。
   * 用 InOut 而非 (ctx, data) 形参，因为 vitest/esbuild 默认不产出 design:paramtypes，
   * FlowContext 形参在测试运行环境无法被 DefaultActionCommandParser 识别。
   */
  function bindInOut(): ActionMethodInOut {
    return {
      fuckIn: (ctx) => {
        const userId = BigInt(String(ctx.getRequest()?.data ?? 0));
        if (userId !== 0n) {
          ctx.bindingUserId(userId);
        }
      },
      fuckOut: () => {},
    };
  }

  function buildSkeleton(): BarSkeleton {
    return new BarSkeletonBuilder()
      .addAction(HookAction)
      .addInOut(bindInOut())
      .build();
  }

  it('onFlowContext 在 inOut/Action 执行前收到本次 ctx，且返回值不变', async () => {
    const skeleton = buildSkeleton();
    let seen: FlowContext | undefined;
    let userIdAtHook: bigint | undefined;

    const response = await skeleton.execute(
      { cmd: 20, subCmd: 1, data: '42' },
      {
        onFlowContext: (ctx) => {
          seen = ctx;
          userIdAtHook = ctx.getUserId();
        },
      },
    );

    expect(response.data).toBe('echo:42');
    expect(seen).toBeInstanceOf(FlowContext);
    // 钩子在 inOut 之前触发；ctx 是同一个活对象，故必须在回调内即时取值
    expect(userIdAtHook).toBe(0n);
    expect(seen?.getUserId()).toBe(42n);
  });

  it('onBound 在 userId !== 0n 时回调一次', async () => {
    const skeleton = buildSkeleton();
    const bound: bigint[] = [];

    const response = await skeleton.execute(
      { cmd: 20, subCmd: 1, data: '42' },
      { onBound: (userId) => bound.push(userId) },
    );

    expect(response.data).toBe('echo:42');
    expect(bound).toEqual([42n]);
  });

  it('userId === 0n 不触发 onBound', async () => {
    const skeleton = buildSkeleton();
    const bound: bigint[] = [];

    const response = await skeleton.execute(
      { cmd: 20, subCmd: 1, data: '0' },
      { onBound: (userId) => bound.push(userId) },
    );

    expect(response.data).toBe('echo:0');
    expect(bound).toEqual([]);
  });

  it('Action 抛错时仍触发 onBound（失败路径）', async () => {
    const skeleton = buildSkeleton();
    const bound: bigint[] = [];

    const response = await skeleton.execute(
      { cmd: 20, subCmd: 2, data: '7' },
      { onBound: (userId) => bound.push(userId) },
    );

    expect(response.errorCode).toBe(500);
    expect(bound).toEqual([7n]);
  });

  it('无 hooks 的既有调用形态保持可用（向后兼容）', async () => {
    const response = await buildSkeleton().execute({ cmd: 20, subCmd: 1, data: '1' });
    expect(response.data).toBe('echo:1');
  });
});

describe('BarSkeletonBuilder', () => {
  it('addAction returns builder for chaining', () => {
    const builder = new BarSkeletonBuilder();
    const result = builder.addAction(HallAction);
    expect(result).toBe(builder);
  });

  it('build creates BarSkeleton with registered actions', () => {
    const skeleton = new BarSkeletonBuilder()
      .addAction(HallAction)
      .build();

    expect(skeleton).toBeInstanceOf(BarSkeleton);
    expect(skeleton.actionCommandRegions.size).toBe(1);
  });

  it('supports custom instance', async () => {
    const customInstance = new HallAction();
    const skeleton = new BarSkeletonBuilder()
      .addAction(HallAction, customInstance)
      .build();

    const response = await skeleton.execute({
      cmd: HALL_CMD.cmd,
      subCmd: HALL_CMD.hello,
      data: 'Bob',
    });

    expect(response.data).toBe('hello Bob');
  });
});
