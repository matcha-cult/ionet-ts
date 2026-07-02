import type { BarSkeletonSetting, ActionMethodInOut } from '@nbb-ionet/core-framework';
import type { ExternalServerOptions } from '@nbb-ionet/external-server';
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

export interface WsServerOptions extends ExternalServerOptions {
  /** Whether to enable the WebSocket server. Default: true */
  enabled?: boolean;
}
