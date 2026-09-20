import type { CmdInfo } from '../cmd-info.js';
import type { Response } from '../flow/flow-context.js';

/**
 * 跨服通信错误码。用于把「未注册路由 / 超时 / 对端下线」等失败显式区分出来，
 * 避免外部服把「没有逻辑服承接」静默降级成普通 404。
 */
export type CrossServerErrorCode =
  | 'NOT_CONFIGURED'
  | 'NOT_REGISTERED'
  | 'TIMEOUT'
  | 'PEER_OFFLINE'
  | 'DUPLICATE_REPLY'
  | 'REMOTE_ERROR';

export interface CrossServerErrorTarget {
  id?: string;
  name?: string;
  tag?: string;
  cmdMerge?: number;
}

export class CrossServerError extends Error {
  readonly code: CrossServerErrorCode;
  readonly target?: CrossServerErrorTarget;

  constructor(code: CrossServerErrorCode, message: string, target?: CrossServerErrorTarget) {
    super(message);
    this.name = 'CrossServerError';
    this.code = code;
    this.target = target;
  }

  /** 映射为该错误在响应信封中的 errorCode（协议层仍是 int，语义靠 errorMessage 表达）。 */
  get errorCode(): number {
    switch (this.code) {
      case 'NOT_REGISTERED':
        return 503;
      case 'PEER_OFFLINE':
        return 502;
      case 'TIMEOUT':
        return 504;
      default:
        return 500;
    }
  }

  static notRegistered(cmdMerge: number): CrossServerError {
    return new CrossServerError(
      'NOT_REGISTERED',
      `No logic server registered for cmdMerge=${cmdMerge}`,
      { cmdMerge },
    );
  }

  static peerOffline(target: CrossServerErrorTarget): CrossServerError {
    return new CrossServerError(
      'PEER_OFFLINE',
      `Logic server ${target.name ?? target.id ?? '?'} is offline (instanceId=${target.id ?? '?'})`,
      target,
    );
  }

  static timeout(target: CrossServerErrorTarget, timeoutMs: number): CrossServerError {
    return new CrossServerError(
      'TIMEOUT',
      `Cross-server call timeout after ${timeoutMs}ms (target=${target.name ?? target.id ?? '?'})`,
      target,
    );
  }

  static notConfigured(): CrossServerError {
    return new CrossServerError(
      'NOT_CONFIGURED',
      'Cross-server communication is not configured on this process: no CrossServerRouter registered',
    );
  }
}

/**
 * 对外（逻辑服）通信的一次调用上下文。userId/traceId/headers 由发起方的 FlowContext 透传，
 * 使被调用的逻辑服可以还原链路与调用者身份。
 */
export interface CrossServerCallContext {
  /** 发起方 FlowContext 的 userId（bigint 以字符串跨进程传输，未绑定为 undefined）。 */
  userId?: string;
  traceId?: string;
  headers?: Record<string, string>;
  /** 本次调用超时（毫秒）；缺省由实现方决定。 */
  timeoutMs?: number;
  /** 显式指定目标逻辑服 tag（用于同类型多实例的应用级 affinity）；缺省按 cmdMerge 路由。 */
  tag?: string;
}

/** 跨服响应：在 core 的 Response 上补充执行方绑定的 userId（登录类 Action 的绑定需要回传）。 */
export interface CrossServerResponse extends Response {
  /** 执行 Action 后绑定的 userId（字符串形式）；未绑定为 undefined。 */
  userId?: string;
}

/**
 * 跨服路由器 SPI。TS 侧的分布式实现（Redis 注册表 + RPC）在 `@nbb-ionet/logic-server`，
 * core-framework 只依赖该抽象，避免核心包反向依赖 Redis。
 *
 * 约定：
 * - `forward` 必须对「未注册路由」抛 `CrossServerError('NOT_REGISTERED')`，不得返回静默成功。
 * - 失败路径必须显式区分 TIMEOUT / PEER_OFFLINE。
 */
export interface CrossServerRouter {
  /** 请求/响应式跨服调用；失败 reject CrossServerError。 */
  forward(
    cmdInfo: CmdInfo,
    data: unknown,
    context: CrossServerCallContext,
  ): Promise<CrossServerResponse>;
  /** 单向跨服发送（fire-and-forget）；仅保证「已投递到传输层」，不承诺对端执行。 */
  forwardSend(
    cmdInfo: CmdInfo,
    data: unknown,
    context: CrossServerCallContext,
  ): Promise<void>;
}
