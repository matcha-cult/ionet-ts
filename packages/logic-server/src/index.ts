// RS1 —— 逻辑服宿主
export type { LogicServer } from './logic-server.js';
export { LogicServerHost, startLogicServer, type LogicServerHostOptions } from './logic-server-host.js';

// RS2 —— 服务器元数据
export { ServerBuilder, randomServerId } from './server-builder.js';

// RS3 —— 分布式路由
export { RedisLogicRouter, type RedisLogicRouterOptions } from './redis-logic-router.js';

// RS6 —— 逻辑服 → 对外服反向通道
export { ExternalCommunication } from './external-communication.js';

// RS6/RS7 —— 对外服分布式运行时接线
export {
  ExternalServerRuntime,
  startExternalServerRuntime,
  type ExternalServerRuntimeOptions,
} from './external-server-runtime.js';

// RS8 —— 跨进程重复路由检测
export {
  detectCrossProcessDuplicateRoutes,
  assertNoCrossProcessDuplicateRoutes,
} from './cross-process-duplicate-check.js';

// 跨服 RPC 协议常量 / 载荷
export {
  RPC_HANDLER_ACTION,
  RPC_HANDLER_ON_EXTERNAL,
  type LogicActionRequestPayload,
  type LogicActionReplyPayload,
} from './protocol.js';
