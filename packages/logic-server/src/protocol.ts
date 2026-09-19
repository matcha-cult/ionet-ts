/** 逻辑服 RPC handler 名（对应 RedisRequestReply.registerHandler 的 key）。 */
export const RPC_HANDLER_ACTION = 'logic.action';
/** 对外服 RPC handler 名：接收 OnExternal 模板并返回结果（existUser 等需要应答）。 */
export const RPC_HANDLER_ON_EXTERNAL = 'external.onExternal';

/** 跨服 Action 请求载荷（由 RedisLogicRouter 发出，LogicServerHost 处理）。 */
export interface LogicActionRequestPayload {
  cmd: number;
  subCmd: number;
  cmdMerge: number;
  data?: unknown;
  /** 调用方 FlowContext 的 userId（bigint 字符串）。 */
  userId?: string;
  traceId?: string;
  headers?: Record<string, string>;
}

/** 跨服 Action 响应载荷（LogicServerHost 回包）。 */
export interface LogicActionReplyPayload {
  data?: unknown;
  errorCode?: number;
  errorMessage?: string;
  /** 执行 Action 后绑定的 userId（登录类 Action 需要回传给对外服登记连接）。 */
  userId?: string;
}
