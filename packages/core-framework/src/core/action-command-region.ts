import { CmdInfo } from './cmd-info.js';
import { type ActionCommand } from './action-command.js';
import { merge } from './cmd-kit.js';

export class ActionCommandRegion {
  readonly cmd: number;
  private readonly subActionCommandMap = new Map<number, ActionCommand>();

  constructor(cmd: number) {
    this.cmd = cmd;
  }

  containsKey(subCmd: number): boolean {
    return this.subActionCommandMap.has(subCmd);
  }

  add(actionCommand: ActionCommand): void {
    const subCmd = actionCommand.cmdInfo.subCmd;
    this.subActionCommandMap.set(subCmd, actionCommand);
  }

  getActionCommand(subCmd: number): ActionCommand | undefined {
    return this.subActionCommandMap.get(subCmd);
  }

  getActionCommandByCmdInfo(cmdInfo: CmdInfo): ActionCommand | undefined {
    return this.subActionCommandMap.get(cmdInfo.subCmd);
  }

  getMaxSubCmd(): number {
    if (this.subActionCommandMap.size === 0) return 0;
    return Math.max(...this.subActionCommandMap.keys());
  }

  get size(): number {
    return this.subActionCommandMap.size;
  }

  getSubCmds(): number[] {
    return Array.from(this.subActionCommandMap.keys());
  }

  values(): ActionCommand[] {
    return Array.from(this.subActionCommandMap.values());
  }
}

export class ActionCommandRegions {
  private readonly regionMap = new Map<number, ActionCommandRegion>();

  getRegion(cmd: number): ActionCommandRegion {
    let region = this.regionMap.get(cmd);
    if (!region) {
      region = new ActionCommandRegion(cmd);
      this.regionMap.set(cmd, region);
    }
    return region;
  }

  getActionCommand(cmdInfo: CmdInfo): ActionCommand | undefined {
    const region = this.regionMap.get(cmdInfo.cmd);
    if (!region) return undefined;
    return region.getActionCommandByCmdInfo(cmdInfo);
  }

  get size(): number {
    return this.regionMap.size;
  }

  getAllActionCommands(): ActionCommand[] {
    const result: ActionCommand[] = [];
    for (const region of this.regionMap.values()) {
      result.push(...region.values());
    }
    return result;
  }

  /** RS2：本进程路由表的全部 cmdMerge，用于服务器元数据注册与跨进程重复路由检测。 */
  listCmdMerges(): number[] {
    const result: number[] = [];
    for (const region of this.regionMap.values()) {
      for (const subCmd of region.getSubCmds()) {
        result.push(merge(region.cmd, subCmd));
      }
    }
    return result;
  }

  getAllRegions(): Map<number, ActionCommandRegion> {
    return new Map(this.regionMap);
  }
}
