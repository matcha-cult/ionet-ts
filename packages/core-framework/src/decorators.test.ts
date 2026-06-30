import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  ActionController,
  ActionMethod,
  getActionControllerCmd,
  getActionMethodSubCmds,
} from './decorators/action-decorators.js';

const HALL_CMD = { cmd: 1, loginVerify: 1, hello: 2 } as const;

@ActionController(HALL_CMD.cmd)
class HallAction {
  @ActionMethod(HALL_CMD.loginVerify)
  login(jwt: string): { id: number; nickname: string } {
    return { id: 12345, nickname: jwt };
  }

  @ActionMethod(HALL_CMD.hello)
  hello(): string {
    return 'hello world';
  }
}

describe('Action Decorators', () => {
  it('should store cmd metadata on controller', () => {
    const cmd = getActionControllerCmd(HallAction);
    expect(cmd).toBe(HALL_CMD.cmd);
  });

  it('should store subCmd metadata on methods', () => {
    const methods = getActionMethodSubCmds(HallAction);
    expect(methods.get('login')).toBe(HALL_CMD.loginVerify);
    expect(methods.get('hello')).toBe(HALL_CMD.hello);
  });

  it('should return empty map for non-decorated class', () => {
    class NoDecorators {}
    const methods = getActionMethodSubCmds(NoDecorators);
    expect(methods.size).toBe(0);
  });

  it('should return undefined for non-decorated controller', () => {
    class NoDecorators {}
    const cmd = getActionControllerCmd(NoDecorators);
    expect(cmd).toBeUndefined();
  });
});
