import {
  CrossServerError,
  type CmdInfo,
  type CrossServerCallContext,
  type CrossServerResponse,
  type CrossServerRouter,
} from '@nbb-ionet/core-framework';
import {
  RpcPeerError,
  RpcTimeoutError,
  type RedisRequestReply,
  type ServerRecord,
  type ServerRegistry,
} from '@nbb-ionet/redis';
import { RPC_HANDLER_ACTION, type LogicActionReplyPayload, type LogicActionRequestPayload } from './protocol.js';

export interface RedisLogicRouterOptions {
  defaultTimeoutMs?: number;
  /** 本实例 id（用于识别自路由）。 */
  selfInstanceId?: string;
}

/**
 * RS3 —— 基于 Redis 注册表的分布式路由器。
 *
 * - `cmdMerge → 逻辑服` 由 `ServerRegistry.findServerByCmdMerge` 解析（同一 cmdMerge 单 owner）；
 * - 请求经 `RedisRequestReply` 走 RPC；
 * - **未注册路由** 显式抛 `CrossServerError('NOT_REGISTERED')`；
 * - 超时后若目标实例心跳已过期，细分为 `PEER_OFFLINE`（对端崩溃可区分）。
 */
export class RedisLogicRouter implements CrossServerRouter {
  private readonly defaultTimeoutMs: number;
  private readonly selfInstanceId?: string;

  constructor(
    private readonly registry: ServerRegistry,
    private readonly rpc: RedisRequestReply,
    options: RedisLogicRouterOptions = {},
  ) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
    this.selfInstanceId = options.selfInstanceId;
  }

  /** 解析承接 cmdMerge 的逻辑服；未注册返回 null。 */
  async resolve(cmdMerge: number, tag?: string): Promise<ServerRecord | null> {
    if (tag !== undefined) {
      const candidates = (await this.registry.findServersByTag(tag)).filter((record) =>
        record.cmdMerges.includes(cmdMerge),
      );
      if (candidates.length === 0) return null;
      return pickLatest(candidates);
    }
    return this.registry.findServerByCmdMerge(cmdMerge);
  }

  async forward(
    cmdInfo: CmdInfo,
    data: unknown,
    context: CrossServerCallContext,
  ): Promise<CrossServerResponse> {
    const target = await this.resolve(cmdInfo.cmdMerge, context.tag);
    if (!target) {
      throw CrossServerError.notRegistered(cmdInfo.cmdMerge);
    }

    const timeoutMs = context.timeoutMs ?? this.defaultTimeoutMs;
    const payload: LogicActionRequestPayload = {
      cmd: cmdInfo.cmd,
      subCmd: cmdInfo.subCmd,
      cmdMerge: cmdInfo.cmdMerge,
      data,
      userId: context.userId,
      traceId: context.traceId,
      headers: context.headers,
    };

    const targetRef = toTarget(target, cmdInfo.cmdMerge);
    try {
      const reply = await this.rpc.call<LogicActionReplyPayload>(
        target.id,
        RPC_HANDLER_ACTION,
        payload,
        { timeoutMs },
      );
      return {
        data: reply.data,
        errorCode: reply.errorCode,
        errorMessage: reply.errorMessage,
        userId: reply.userId,
      };
    } catch (error) {
      throw await this.classify(error, target, targetRef, timeoutMs);
    }
  }

  async forwardSend(
    cmdInfo: CmdInfo,
    data: unknown,
    context: CrossServerCallContext,
  ): Promise<void> {
    const target = await this.resolve(cmdInfo.cmdMerge, context.tag);
    if (!target) {
      throw CrossServerError.notRegistered(cmdInfo.cmdMerge);
    }
    const payload: LogicActionRequestPayload = {
      cmd: cmdInfo.cmd,
      subCmd: cmdInfo.subCmd,
      cmdMerge: cmdInfo.cmdMerge,
      data,
      userId: context.userId,
      traceId: context.traceId,
      headers: context.headers,
    };
    await this.rpc.send(target.id, RPC_HANDLER_ACTION, payload);
  }

  /** 超时 → 按注册表存活状态细分为 PEER_OFFLINE / TIMEOUT；对端报错 → REMOTE_ERROR。 */
  private async classify(
    error: unknown,
    target: ServerRecord,
    targetRef: { id: string; name: string; tag: string; cmdMerge: number },
    timeoutMs: number,
  ): Promise<CrossServerError> {
    if (error instanceof RpcTimeoutError) {
      const alive = await this.registry.isAlive(target.id);
      if (!alive) {
        return CrossServerError.peerOffline(targetRef);
      }
      return CrossServerError.timeout(targetRef, timeoutMs);
    }
    if (error instanceof RpcPeerError) {
      return new CrossServerError('REMOTE_ERROR', error.message, targetRef);
    }
    if (error instanceof CrossServerError) {
      return error;
    }
    return new CrossServerError(
      'REMOTE_ERROR',
      error instanceof Error ? error.message : String(error),
      targetRef,
    );
  }
}

function pickLatest(candidates: ServerRecord[]): ServerRecord {
  return candidates.reduce((latest, record) =>
    record.startedAt > latest.startedAt ||
    (record.startedAt === latest.startedAt && record.id > latest.id)
      ? record
      : latest,
  );
}

function toTarget(
  record: ServerRecord,
  cmdMerge: number,
): { id: string; name: string; tag: string; cmdMerge: number } {
  return { id: record.id, name: record.name, tag: record.tag, cmdMerge };
}
