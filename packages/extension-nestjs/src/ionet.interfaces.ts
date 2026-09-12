import type { BarSkeletonSetting, ActionMethodInOut } from '@nbb-ionet/core-framework';
import type { ExternalServerOptions, WebSocketExternalServerOptions } from '@nbb-ionet/external-server';
import type { RedisClientOptions } from '@nbb-ionet/redis';

export interface IonetModuleOptions {
  /** Action classes decorated with @ActionController */
  actions?: Array<new (...args: any[]) => any>;
  /** InOut plugins for the action pipeline */
  inOuts?: ActionMethodInOut[];
  /** BarSkeleton settings (slow threshold, etc.) */
  setting?: BarSkeletonSetting;
  /** HTTP External Server options. Set to false to disable. */
  httpServer?: HttpServerOptions | false;
  /** WebSocket External Server options. Set to false to disable. */
  wsServer?: WsServerOptions | false;
  /** Redis options. Set to false to disable. */
  redis?: RedisClientOptions | false;
  /**
   * 是否允许在 NODE_ENV=production 下运行本模块（默认 false）。
   * 默认行为仍是「生产禁用」；仅在明确知晓部署形态（自管 Node 进程 + 自有发布流程）时才置 true。
   */
  allowProduction?: boolean;
}

export interface IonetModuleAsyncOptions {
  useFactory: (...args: any[]) => Promise<IonetModuleOptions> | IonetModuleOptions;
  inject?: any[];
  imports?: any[];
}

export interface IonetFeatureOptions {
  /** Action classes to register in this feature module */
  actions: Array<new (...args: any[]) => any>;
}

export interface HttpServerOptions extends ExternalServerOptions {
  /** Whether to enable the HTTP server. Default: true */
  enabled?: boolean;
}

/**
 * WS 通道配置。两种形态（二选一）：
 * - 独立模式：给出 port，WebSocketExternalServer 自起 listener（既有形态，生产独立部署亦走此模式）。
 * - attach 模式：attachNestServer: true 且省略 port，WS upgrade 挂载到 NestJS 应用的
 *   http.Server（端口三合一形态，见 idle-matcha ai-docs/port-consolidation-3in1.md）。
 * server 字段不在此暴露——由模块在 onModuleInit 经 HttpAdapterHost 取得后注入。
 */
export interface WsServerOptions extends Omit<WebSocketExternalServerOptions, 'port' | 'server'> {
  /** Whether to enable the WebSocket server. Default: true */
  enabled?: boolean;
  /** 独立模式端口。attachNestServer 不为 true 时必填 */
  port?: number;
  /** attach 模式：挂载到 NestJS http.Server（三合一单端口）。为 true 时省略 port */
  attachNestServer?: boolean;
}
