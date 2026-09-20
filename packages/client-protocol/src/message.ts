/**
 * ionet 线协议信封类型（PROTOCOL.md §3/§4/§5）——浏览器侧单一真相。
 * 与框架侧 `core-framework/src/protocol/message.ts` 逐字段一致，但本包零 Node 依赖、
 * 不 import core-framework（浏览器可加载）。字段语义以 PROTOCOL.md 为唯一规格。
 */

/** 报文判别（PROTOCOL.md §4/§5）：响应（对应某次请求）或服务端主动通知/广播。 */
export type ResponseKind = 'response' | 'notification';

/**
 * 请求信封（PROTOCOL.md §3，客户端 → 服务端）。
 * kind 不出现：路由由 cmd/subCmd 决定；reqId 属于新协议（服务端只在请求携带时回显）。
 */
export interface RequestMessage {
  /** 必须：路由主命令。 */
  cmd: number;
  /** 必须：路由子命令。 */
  subCmd: number;
  /** 可选：业务载荷。 */
  data?: unknown;
  /** 可选：透传给 FlowContext 的头部（如 traceId、灰度标签）。 */
  headers?: Record<string, string>;
  /** 可选：全链路追踪 id。 */
  traceId?: string;
  /** 可选：客户端请求配对 id（string | number），新协议启用；服务端原样回显。 */
  reqId?: string | number;
}

/**
 * 响应信封（PROTOCOL.md §4，服务端 → 客户端）。
 * reqId/kind 仅在新协议路径（请求携带 reqId）显式写入 —— 旧客户端响应逐字节不变（§12.1）。
 */
export interface ResponseMessage {
  /** 成功 payload。 */
  data?: unknown;
  /** 0 / 缺失 = 成功。 */
  errorCode?: number;
  /** 失败原因。 */
  errorMessage?: string;
  headers?: Record<string, string>;
  /** 回显请求的 reqId；请求未携带 / 旧服务不产出的帧中不出现该键。 */
  reqId?: string | number;
  /** 判别响应 / 通知；仅新协议路径写入。 */
  kind?: ResponseKind;
}

/**
 * 推送信封（PROTOCOL.md §5，服务端主动 → 客户端）。
 * kind 恒为 'notification'：这是框架语义的唯一推送出口，禁止业务自造形状（§2.2.4）。
 */
export interface NotificationMessage {
  /** 必须：判别字段。 */
  kind: 'notification';
  /** 可选：事件名（与 cmd/subCmd 编码体系并列）。 */
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

/** 线帧判别（PROTOCOL.md §5：客户端据 kind 与响应区分请求/响应/推送）。 */
export type FrameKind = 'request' | 'response' | 'notification' | 'unknown';

/**
 * 解码出的线帧视图：已知字段 + 任意未知字段（前向兼容，§12.3 透传）。
 * 业务帧可能携带未来版本新增字段，解码不做裁剪。
 */
export type WireFrame = Record<string, unknown> & Partial<EnvelopeMessage>;

/** 全部信封类型的联合（编码/解码面的宽类型视图）。 */
export type EnvelopeMessage = RequestMessage | ResponseMessage | NotificationMessage;

/** createNotificationMessage 入参：仅显式给出的可选字段才写入。 */
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

/** 构造请求信封（PROTOCOL.md §3 字段集）。 */
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

/**
 * 构造响应信封（PROTOCOL.md §4）。
 * reqId/kind 未提供时不写入键：JSON.stringify 下与旧协议响应逐字节一致（§12.1/§12.2）。
 */
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
    ...(options.reqId !== undefined ? { reqId: options.reqId } : {}),
    ...(options.kind !== undefined ? { kind: options.kind } : {}),
  };
}

/**
 * 构造推送信封（kind = 'notification'，PROTOCOL.md §5）。
 * 与框架侧唯一的推送构造出口语义一致：仅显式给出的可选字段才写入，
 * kind 之外字段集可裁剪，JSON.stringify 下与旧格式逐字节兼容。
 */
export function createNotificationMessage(options: NotificationMessageInput = {}): NotificationMessage {
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

/** PROTOCOL.md §8：客户端统一判定 errorCode !== 0 为失败。 */
export function isSuccess(response: { errorCode?: number }): boolean {
  return !response.errorCode || response.errorCode === 0;
}
