import { CmdInfo } from './cmd-info.js';
import { merge, getCmd, getSubCmd } from './cmd-kit.js';

class CmdInfoFlyweight {
  private readonly cache = new Map<number, CmdInfo>();

  of(cmd: number, subCmd: number): CmdInfo {
    const cmdMerge = merge(cmd, subCmd);
    return this.getByMerge(cmdMerge);
  }

  ofByMerge(cmdMerge: number): CmdInfo {
    return this.getByMerge(cmdMerge);
  }

  private getByMerge(cmdMerge: number): CmdInfo {
    let instance = this.cache.get(cmdMerge);
    if (!instance) {
      const cmd = getCmd(cmdMerge);
      const subCmd = getSubCmd(cmdMerge);
      instance = CmdInfo.create(cmd, subCmd);
      this.cache.set(cmdMerge, instance);
    }
    return instance;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export const CmdInfoFlyweightFactory = new CmdInfoFlyweight();
