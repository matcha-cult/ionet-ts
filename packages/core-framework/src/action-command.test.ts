import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ActionController, ActionMethod } from './decorators/action-decorators.js';
import { CmdInfo } from './core/cmd-info.js';
import { ActionCommandRegion, ActionCommandRegions } from './core/action-command-region.js';
import { DefaultActionCommandParser } from './core/action-command-parser.js';

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

describe('ActionCommandRegion', () => {
  it('stores action commands by subCmd', () => {
    const region = new ActionCommandRegion(1);
    const cmd = CmdInfo.of(1, 5);
    const action = {
      cmdInfo: cmd,
      actionController: {},
      actionControllerClass: HallAction,
      methodName: 'test',
      method: () => {},
      actionMethodParameters: [],
      actionMethodReturn: { type: 'void', isArray: false },
    };

    region.add(action);
    expect(region.containsKey(5)).toBe(true);
    expect(region.getActionCommand(5)).toBe(action);
    expect(region.size).toBe(1);
  });

  it('getMaxSubCmd returns highest subCmd', () => {
    const region = new ActionCommandRegion(1);
    expect(region.getMaxSubCmd()).toBe(0);

    const action1 = {
      cmdInfo: CmdInfo.of(1, 3),
      actionController: {},
      actionControllerClass: HallAction,
      methodName: 'a',
      method: () => {},
      actionMethodParameters: [],
      actionMethodReturn: { type: 'void', isArray: false },
    };
    const action2 = {
      ...action1,
      cmdInfo: CmdInfo.of(1, 7),
      methodName: 'b',
    };
    region.add(action1);
    region.add(action2);
    expect(region.getMaxSubCmd()).toBe(7);
  });
});

describe('ActionCommandRegions', () => {
  it('manages multiple regions', () => {
    const regions = new ActionCommandRegions();
    const region1 = regions.getRegion(1);
    const region2 = regions.getRegion(2);
    expect(region1).not.toBe(region2);
    expect(regions.size).toBe(2);

    const cmd = CmdInfo.of(1, 5);
    const action = {
      cmdInfo: cmd,
      actionController: {},
      actionControllerClass: HallAction,
      methodName: 'test',
      method: () => {},
      actionMethodParameters: [],
      actionMethodReturn: { type: 'void', isArray: false },
    };
    region1.add(action);

    expect(regions.getActionCommand(cmd)).toBe(action);
    expect(regions.getActionCommand(CmdInfo.of(2, 5))).toBeUndefined();
  });
});

describe('DefaultActionCommandParser', () => {
  it('parses decorated class and registers actions', () => {
    const parser = new DefaultActionCommandParser();
    const instance = new HallAction();
    const regions = new ActionCommandRegions();

    const parsed = parser.parse(HallAction, instance, { actionCommandRegions: regions });

    expect(parsed).toHaveLength(2);
    expect(regions.size).toBe(1);

    const loginCmd = CmdInfo.of(HALL_CMD.cmd, HALL_CMD.loginVerify);
    const loginAction = regions.getActionCommand(loginCmd);
    expect(loginAction).toBeDefined();
    expect(loginAction!.cmdInfo).toBe(loginCmd);
    expect(loginAction!.methodName).toBe('login');

    const helloCmd = CmdInfo.of(HALL_CMD.cmd, HALL_CMD.hello);
    const helloAction = regions.getActionCommand(helloCmd);
    expect(helloAction).toBeDefined();
    expect(helloAction!.methodName).toBe('hello');
  });

  it('throws for non-decorated class', () => {
    class NotDecorated {}
    const parser = new DefaultActionCommandParser();
    const regions = new ActionCommandRegions();

    expect(() => parser.parse(NotDecorated, new NotDecorated(), { actionCommandRegions: regions })).toThrow(
      /not decorated with @ActionController/,
    );
  });

  it('notifies listeners on parse', () => {
    const parser = new DefaultActionCommandParser();
    const instance = new HallAction();
    const regions = new ActionCommandRegions();
    const notified: string[] = [];

    parser.parse(HallAction, instance, { actionCommandRegions: regions }, [
      {
        onActionCommandParsed(actionCommand) {
          notified.push(actionCommand.methodName);
        },
      },
    ]);

    expect(notified).toContain('login');
    expect(notified).toContain('hello');
  });
});
