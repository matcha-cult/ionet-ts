import { type ActionCommandRegions } from '../action-command-region.js';

export interface DuplicateRoute {
  cmd: number;
  subCmd: number;
  regions: string[];
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
}
