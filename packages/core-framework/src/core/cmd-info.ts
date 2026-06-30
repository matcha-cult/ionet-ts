import { merge, getCmd, getSubCmd, toString as cmdToString } from './cmd-kit.js';
import { CmdInfoFlyweightFactory } from './cmd-info-flyweight.js';

export class CmdInfo {
  private constructor(
    readonly cmd: number,
    readonly subCmd: number,
    readonly cmdMerge: number,
  ) {
    Object.freeze(this);
  }

  static of(cmd: number, subCmd: number): CmdInfo;
  static of(cmdMerge: number): CmdInfo;
  static of(cmdOrMerge: number, subCmd?: number): CmdInfo {
    if (subCmd !== undefined) {
      return CmdInfoFlyweightFactory.of(cmdOrMerge, subCmd);
    }
    return CmdInfoFlyweightFactory.ofByMerge(cmdOrMerge);
  }

  static create(cmd: number, subCmd: number): CmdInfo {
    return new CmdInfo(cmd, subCmd, merge(cmd, subCmd));
  }

  equals(other: CmdInfo): boolean {
    return this.cmdMerge === other.cmdMerge;
  }

  toString(): string {
    return cmdToString(this.cmdMerge);
  }

  toJSON(): { cmd: number; subCmd: number; cmdMerge: number } {
    return { cmd: this.cmd, subCmd: this.subCmd, cmdMerge: this.cmdMerge };
  }
}

export { getCmd, getSubCmd };
