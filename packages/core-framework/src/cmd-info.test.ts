import { describe, it, expect } from 'vitest';
import { merge, getCmd, getSubCmd, toString, toSimpleString } from './core/cmd-kit.js';
import { CmdInfo } from './core/cmd-info.js';
import { CmdInfoFlyweightFactory } from './core/cmd-info-flyweight.js';

describe('CmdKit', () => {
  it('merge combines cmd and subCmd via bit shift', () => {
    const merged = merge(1, 1);
    expect(merged).toBe((1 << 16) | 1);
  });

  it('getCmd extracts upper 16 bits', () => {
    expect(getCmd(merge(100, 50))).toBe(100);
  });

  it('getSubCmd extracts lower 16 bits', () => {
    expect(getSubCmd(merge(100, 50))).toBe(50);
  });

  it('toString formats correctly', () => {
    expect(toString(merge(1, 2))).toBe('[cmd:1-2 65538]');
  });

  it('toSimpleString formats correctly', () => {
    expect(toSimpleString(1, 2)).toBe('1-2');
  });
});

describe('CmdInfo', () => {
  it('of(cmd, subCmd) creates frozen instance', () => {
    const cmd = CmdInfo.of(1, 1);
    expect(cmd.cmd).toBe(1);
    expect(cmd.subCmd).toBe(1);
    expect(cmd.cmdMerge).toBe((1 << 16) | 1);
    expect(Object.isFrozen(cmd)).toBe(true);
  });

  it('of(cmdMerge) extracts components', () => {
    const cmd = CmdInfo.of((5 << 16) | 10);
    expect(cmd.cmd).toBe(5);
    expect(cmd.subCmd).toBe(10);
    expect(cmd.cmdMerge).toBe((5 << 16) | 10);
  });

  it('flyweight returns same instance for same cmdMerge', () => {
    const a = CmdInfo.of(1, 1);
    const b = CmdInfo.of((1 << 16) | 1);
    expect(a).toBe(b);
  });

  it('flyweight returns different instances for different cmdMerge', () => {
    const a = CmdInfo.of(1, 1);
    const b = CmdInfo.of(1, 2);
    expect(a).not.toBe(b);
  });

  it('equals compares by cmdMerge', () => {
    const a = CmdInfo.of(1, 1);
    const b = CmdInfo.of(1, 1);
    expect(a.equals(b)).toBe(true);
  });

  it('toString returns formatted string', () => {
    const cmd = CmdInfo.of(1, 2);
    expect(cmd.toString()).toBe('[cmd:1-2 65538]');
  });
});

describe('CmdInfoFlyweightFactory', () => {
  it('caches instances', () => {
    const size1 = CmdInfoFlyweightFactory.size;
    CmdInfo.of(100, 200);
    expect(CmdInfoFlyweightFactory.size).toBe(size1 + 1);
  });
});
