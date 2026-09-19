import { type ActionCommandRegions } from '../action-command-region.js';
import { getCmd, getSubCmd } from '../cmd-kit.js';

export interface DuplicateRoute {
  cmd: number;
  subCmd: number;
  regions: string[];
}

/** RS8：来自服务器注册表的 cmdMerge 区域（每个逻辑服一条）。 */
export interface CmdMergeRegion {
  label: string;
  cmdMerges: number[];
}

export class ActionCommandRegionGlobalCheckKit {
  static detectGlobalDuplicateRoutes(
    regionsList: Array<{ label: string; regions: ActionCommandRegions }>,
  ): DuplicateRoute[] {
    const routeMap = new Map<number, Array<{ label: string; subCmd: number }>>();

    for (const { label, regions } of regionsList) {
      for (const [cmd, region] of regions.getAllRegions()) {
        for (const subCmd of region.getSubCmds()) {
          const key = (cmd << 16) | subCmd;
          if (!routeMap.has(key)) {
            routeMap.set(key, []);
          }
          routeMap.get(key)!.push({ label, subCmd });
        }
      }
    }

    const duplicates: DuplicateRoute[] = [];
    for (const [key, entries] of routeMap) {
      if (entries.length > 1) {
        const cmd = key >> 16;
        const subCmd = key & 0xffff;
        duplicates.push({
          cmd,
          subCmd,
          regions: entries.map((e) => e.label),
        });
      }
    }

    return duplicates;
  }

  static assertNoDuplicateRoutes(
    regionsList: Array<{ label: string; regions: ActionCommandRegions }>,
  ): void {
    const duplicates = this.detectGlobalDuplicateRoutes(regionsList);
    if (duplicates.length > 0) {
      const details = duplicates
        .map(
          (d) =>
            `cmd=${d.cmd}, subCmd=${d.subCmd} registered in: ${d.regions.join(', ')}`,
        )
        .join('\n  ');
      throw new Error(`Duplicate routes detected:\n  ${details}`);
    }
  }

  /**
   * RS8：直接以注册表来源的 cmdMerge 列表做跨进程重复路由检测。
   * 语义与 `detectGlobalDuplicateRoutes` 一致，但输入不需要真实 ActionCommand。
   */
  static detectGlobalDuplicateCmdMerges(regionsList: CmdMergeRegion[]): DuplicateRoute[] {
    const routeMap = new Map<number, string[]>();

    for (const { label, cmdMerges } of regionsList) {
      for (const cmdMerge of cmdMerges) {
        if (!routeMap.has(cmdMerge)) {
          routeMap.set(cmdMerge, []);
        }
        routeMap.get(cmdMerge)!.push(label);
      }
    }

    const duplicates: DuplicateRoute[] = [];
    for (const [cmdMerge, labels] of routeMap) {
      if (labels.length > 1) {
        duplicates.push({
          cmd: getCmd(cmdMerge),
          subCmd: getSubCmd(cmdMerge),
          regions: labels,
        });
      }
    }
    return duplicates;
  }

  static assertNoDuplicateCmdMerges(regionsList: CmdMergeRegion[]): void {
    const duplicates = this.detectGlobalDuplicateCmdMerges(regionsList);
    if (duplicates.length > 0) {
      const details = duplicates
        .map(
          (d) =>
            `cmd=${d.cmd}, subCmd=${d.subCmd} registered in: ${d.regions.join(', ')}`,
        )
        .join('\n  ');
      throw new Error(`Duplicate routes detected across processes:\n  ${details}`);
    }
  }
}
