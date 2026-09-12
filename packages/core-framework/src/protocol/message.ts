import { CmdInfo } from '../core/cmd-info.js';

/**
 * 报文判别类型：响应（对应某次请求）或服务端主动通知/广播。
 * 仅在客户端启用新协议（请求携带 reqId）时才写入响应，以保持旧客户端逐字节兼容。
 */
export type ResponseKind = 'response' | 'notification';

export interface RequestMessage {
  cmd: number;
  subCmd: number;
  data?: unknown;
  headers?: Record<string, string>;
  traceId?: string;
  /**
   * 客户端请求配对 id（可选，string | number）。
   * 服务端只在请求确实携带时回显；未携带则响应中不出现该字段。
   */
  reqId?: string | number;
}

export function createRequestMessage(options: {
  cmd: number;
  subCmd: number;
  data?: unknown;
  headers?: Record<string, string>;
  traceId?: string;
  reqId?: string | number;
}): RequestMessage {
  return {
    cmd: options.cmd,
    subCmd: options.subCmd,
    data: options.data,
    headers: options.headers,
    traceId: options.traceId,
    reqId: options.reqId,
  };
}

export function requestMessageToCmdInfo(request: RequestMessage): CmdInfo {
  return CmdInfo.of(request.cmd, request.subCmd);
}

export interface ResponseMessage {
  data?: unknown;
  errorCode?: number;
  errorMessage?: string;
  headers?: Record<string, string>;
  /** 回显请求的 reqId；请求未携带时不出现（逐字节兼容旧客户端）。 */
  reqId?: string | number;
  /** 判别响应 / 通知。仅在新协议路径显式给出时写入。 */
  kind?: ResponseKind;
}

export function createResponseMessage(options: {
  data?: unknown;
  errorCode?: number;
  errorMessage?: string;
  headers?: Record<string, string>;
  reqId?: string | number;
  kind?: ResponseKind;
}): ResponseMessage {
  return {
    data: options.data,
    errorCode: options.errorCode,
    errorMessage: options.errorMessage,
    headers: options.headers,
    // 未提供时不写入键：JSON.stringify 下与改动前逐字节一致
    ...(options.reqId !== undefined ? { reqId: options.reqId } : {}),
    ...(options.kind !== undefined ? { kind: options.kind } : {}),
  };
}

/**
 * 服务端主动推送信封（framework-canonical push envelope）。
 * 由框架统一构造，业务不得自造形状；kind 与响应侧共享取值域 'response' | 'notification'。
 *
 * 字段集：{ kind, type?, cmd?, subCmd?, data, timestamp?, headers?, reqId?, fromUserId? }。
 * 仅显式给出的可选字段才写入；未给出时不出现键，JSON.stringify 下与旧格式逐字节兼容。
 */
export interface NotificationMessage {
  kind: 'notification';
  /** 事件名（与 cmd/subCmd 编码体系并列；二选一或并存，由订阅路由决定）。 */
  type?: string;
  cmd?: number;
  subCmd?: number;
  data?: unknown;
  timestamp?: number;
  headers?: Record<string, string>;
  /** 若该推送在语义上对应某次请求，可回显 reqId。 */
  reqId?: string | number;
  /** 广播来源用户（Broadcaster 路径保留的元信息）。 */
  fromUserId?: string;
}

export interface NotificationMessageInput {
  type?: string;
  cmd?: number;
  subCmd?: number;
  data?: unknown;
  timestamp?: number;
  headers?: Record<string, string>;
  reqId?: string | number;
  fromUserId?: string;
}

/**
 * 构造服务端主动通知/广播信封（kind = 'notification'），与请求响应可判别。
 * 这是框架内唯一的推送信封构造入口：ws 传输的规范化推送方法、
 * MemoryBroadcaster 均须经此构造，禁止业务自造形状。
 */
export function createNotificationMessage(options: NotificationMessageInput): NotificationMessage {
  return {
    kind: 'notification',
    ...(options.type !== undefined ? { type: options.type } : {}),
    ...(options.cmd !== undefined ? { cmd: options.cmd } : {}),
    ...(options.subCmd !== undefined ? { subCmd: options.subCmd } : {}),
    data: options.data,
    ...(options.timestamp !== undefined ? { timestamp: options.timestamp } : {}),
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
    ...(options.reqId !== undefined ? { reqId: options.reqId } : {}),
    ...(options.fromUserId !== undefined ? { fromUserId: options.fromUserId } : {}),
  };
}

export function isSuccessResponse(response: ResponseMessage): boolean {
  return !response.errorCode || response.errorCode === 0;
}
