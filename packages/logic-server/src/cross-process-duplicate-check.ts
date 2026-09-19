import {
  ActionCommandRegionGlobalCheckKit,
  type CmdMergeRegion,
  type DuplicateRoute,
} from '@nbb-ionet/core-framework';
import type { ServerRegistry } from '@nbb-ionet/redis';

/**
 * RS8 —— 跨进程重复路由检测。
 *
 * 从服务器注册表读取全部存活逻辑服的 `cmdMerges` 区域，喂给
 * `ActionCommandRegionGlobalCheckKit`（进程内版同一套判定），启动期检出
 * 「同一 cmdMerge 被多个逻辑服承接」的部署错误。
 */
export async function detectCrossProcessDuplicateRoutes(
  registry: ServerRegistry,
): Promise<DuplicateRoute[]> {
  return ActionCommandRegionGlobalCheckKit.detectGlobalDuplicateCmdMerges(
    await registryCmdMergeRegions(registry),
  );
}

/** 与 `detectCrossProcessDuplicateRoutes` 同类，但检出即抛错（启动期使用）。 */
export async function assertNoCrossProcessDuplicateRoutes(
  registry: ServerRegistry,
): Promise<void> {
  ActionCommandRegionGlobalCheckKit.assertNoDuplicateCmdMerges(
    await registryCmdMergeRegions(registry),
  );
}

async function registryCmdMergeRegions(registry: ServerRegistry): Promise<CmdMergeRegion[]> {
  const servers = await registry.listAlive();
  return servers.map((server) => ({
    label: `${server.name}(${server.id})`,
    cmdMerges: server.cmdMerges,
  }));
}
