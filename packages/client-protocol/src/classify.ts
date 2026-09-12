import type { FrameKind, NotificationMessage, WireFrame } from './message.js';

/**
 * PROTOCOL.md §5「kind 分流判定」——客户端收到一帧后判别它的语义：
 *
 *   1. kind === 'notification'  → 服务端主动推送（§5，框架规范化路径恒带 kind）；
 *   2. kind === 'response'      → 某次请求的响应（§4 新协议路径）；
 *   3. 无 kind 但带 cmd/subCmd  → 请求帧（旧协议请求恒无 kind；响应不回显 cmd/subCmd）；
 *   4. kind 存在但取值域外     → 'unknown'（协议外值，交由调用方处置）；
 *   5. 无 kind 且无 cmd/subCmd  → 'response'（旧服务不带 reqId/kind 的响应，§4/§12 兼容）。
 *
 * 注：旧版裸透传推送（broadcast(unknown)，无 kind）与旧响应在形状上不可判别，
 * 客户端按 §5 只能依赖 kind 分流；此处归入 'response'，调用方按 data/errorCode 语义处理。
 */
export function classifyFrame(frame: Record<string, unknown>): FrameKind {
  const kind = frame['kind'];
  if (kind === 'notification') return 'notification';
  if (kind === 'response') return 'response';
  if (typeof frame['cmd'] === 'number' && typeof frame['subCmd'] === 'number') return 'request';
  if (kind !== undefined) return 'unknown';
  return 'response';
}

/** 推送帧类型守卫：kind === 'notification'。 */
export function isNotificationFrame(
  frame: Record<string, unknown>,
): frame is WireFrame & NotificationMessage {
  return classifyFrame(frame) === 'notification';
}
