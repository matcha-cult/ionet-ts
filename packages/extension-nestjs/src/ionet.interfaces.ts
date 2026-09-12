import type {
  BarSkeletonSetting,
  ActionMethodInOut,
  ActionFactoryBean,
} from '@nbb-ionet/core-framework';
import type { HttpExternalServerOptions, WebSocketExternalServerOptions } from '@nbb-ionet/external-server';
import type { RedisClientOptions } from '@nbb-ionet/redis';
import type { NestActionResolver } from './action-factory-bean-for-nest.js';

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
   * 是否提供 Broadcaster provider（默认 true）。
   * 置 false 时不创建 IONET_BROADCASTER；未使用推送的部署可据此保持零新增开销。
   */
  broadcaster?: false;
  /**
   * 是否允许在 NODE_ENV=production 下运行本模块（默认 false）。
   * 默认行为仍是「生产禁用」；仅在明确知晓部署形态（自管 Node 进程 + 自有发布流程）时才置 true。
   */
  allowProduction?: boolean;
  /**
   * 自定义 Action 实例工厂（任务 4，高级用法）：从 DI 容器解析实例。
   * 配置后框架不会直接 new ActionClass()，而是在 onModuleInit 阶段（app 就绪后）
   * 经该工厂解析并注册，使 Action 拿到容器依赖。
   */
  actionFactory?: ActionFactoryBean;
  /**
   * actionFactory 的简化形式：仅提供 (ActionClass) => instance 的解析函数。
   * 例：forRoot({ actions, resolveAction: (Cls) => app.get(Cls) })。
   *
   * 注意：不要在框架侧注入 @nestjs/core 类令牌（ModuleRef 等）——跨仓库 workspace
   * 链接下可能解析到不同副本而静默为 undefined。用本函数由应用侧显式解析即可绕开。
   */
  resolveAction?: NestActionResolver;
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

/**
 * HTTP 通道配置。继承传输层 `HttpExternalServerOptions`，因此 `pathPrefix` 可在此配置
 * 并经 forRoot / forRootAsync 透传（默认 `/api`，见 PROTOCOL.md §9）。
 */
export interface HttpServerOptions extends HttpExternalServerOptions {
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
