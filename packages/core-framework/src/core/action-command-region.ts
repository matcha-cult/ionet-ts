import { CmdInfo } from './cmd-info.js';
import { type ActionCommand } from './action-command.js';

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
}
