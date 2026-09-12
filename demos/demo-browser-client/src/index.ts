/**
 * demo-browser-client 公共入口（供浏览器 module bundler / 直接 <script type="module"> 引用）。
 * 零依赖：本包不依赖任何框架 workspace 包与 Node 内置模块。
 */

export {
  BrowserIonetClient,
  DEFAULT_HEARTBEAT_ROUTE,
  isSuccess,
  type ConnectionState,
  type HeartbeatOptions,
  type HttpRequestOptions,
  type IonetClientOptions,
  type IonetFrame,
  type NotificationEnvelope,
  type ReconnectOptions,
  type RequestEnvelope,
  type RequestOptions,
  type ResponseEnvelope,
  type ResponseKind,
} from './client.js';
