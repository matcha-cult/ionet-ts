import type { BarSkeleton, BarSkeletonBuilder } from '@nbb-ionet/core-framework';
import type { ServerBuilder } from './server-builder.js';

/**
 * RS1 —— 逻辑服宿主抽象（对应 Java `com.iohao.net.server.LogicServer`）。
 *
 * KB `rules/logic-server-rules.md` 约束（消费方模块侧）：
 * - 命名 `*LogicServer`、放模块根包；
 * - 两个 builder 方法必填，只做 builder 配置，不写业务；
 * - `startupSuccess` 可选，仅用于生命周期接线。
 *
 * 框架侧只定义接口与启动器；业务 Action 仍写在 Action 类里。
 */
export interface LogicServer {
  /** 配置模块级 Action 路由（如 scanActionPackage 等价物 / addAction）。 */
  settingBarSkeletonBuilder(builder: BarSkeletonBuilder): void;
  /** 配置模块级服务器元数据（name/tag/id/…）。 */
  settingServerBuilder(builder: ServerBuilder): void;
  /** 启动成功回调（生命周期接线用，不承载业务路由处理）。 */
  startupSuccess?(barSkeleton: BarSkeleton): void;
}
