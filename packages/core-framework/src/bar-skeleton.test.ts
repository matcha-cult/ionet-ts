import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ActionController, ActionMethod } from './decorators/action-decorators.js';
import { BarSkeleton, BarSkeletonBuilder } from './core/bar-skeleton.js';
import { FlowContext } from './core/flow/flow-context.js';

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
