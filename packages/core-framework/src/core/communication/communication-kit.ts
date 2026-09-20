import { CmdInfo } from '../cmd-info.js';
import type { FlowContext } from '../flow/flow-context.js';
import {
  CrossServerError,
  type CrossServerCallContext,
  type CrossServerResponse,
  type CrossServerRouter,
} from './types.js';

/**
 * 进程级跨服通信入口。由逻辑服 / 分布式外部服启动时注入具体路由器
 * （`@nbb-ionet/logic-server` 的 Redis 实现），Action 内统一经 `FlowContext.call/send` 使用。
 *
 * 未配置时调用必须显式报错（NOT_CONFIGURED），不得静默丢弃。
 */
class CommunicationKitImpl {
  private router: CrossServerRouter | null = null;

  setCrossServerRouter(router: CrossServerRouter | null): void {
    this.router = router;
  }

  getCrossServerRouter(): CrossServerRouter | null {
    return this.router;
  }

  isConfigured(): boolean {
    return this.router !== null;
  }

  clear(): void {
    this.router = null;
  }

  async call(
    ctx: FlowContext,
    cmdInfo: CmdInfo,
    data: unknown,
    options?: CrossServerCallContext,
  ): Promise<CrossServerResponse> {
    const router = this.requireRouter();
    return router.forward(cmdInfo, data, this.buildContext(ctx, options));
  }

  async send(
    ctx: FlowContext,
    cmdInfo: CmdInfo,
    data: unknown,
    options?: CrossServerCallContext,
  ): Promise<void> {
    const router = this.requireRouter();
    await router.forwardSend(cmdInfo, data, this.buildContext(ctx, options));
  }

  private requireRouter(): CrossServerRouter {
    if (!this.router) {
      throw CrossServerError.notConfigured();
    }
    return this.router;
  }

  private buildContext(ctx: FlowContext, options?: CrossServerCallContext): CrossServerCallContext {
    const request = ctx.getRequest();
    const userId = ctx.getUserId();
    const context: CrossServerCallContext = {
      userId: userId === 0n ? undefined : userId.toString(),
      traceId: request?.traceId,
      headers: request?.headers,
    };
    if (options?.timeoutMs !== undefined) context.timeoutMs = options.timeoutMs;
    if (options?.tag !== undefined) context.tag = options.tag;
    return context;
  }
}

export const CommunicationKit = new CommunicationKitImpl();

/** 便捷重载解析：支持 (cmd, subCmd) 与 CmdInfo 两种调用形态。 */
export function resolveCmdInfo(
  cmdOrCmdInfo: number | CmdInfo,
  subCmd?: number,
): CmdInfo {
  if (cmdOrCmdInfo instanceof CmdInfo) {
    return cmdOrCmdInfo;
  }
  if (subCmd === undefined) {
    throw new Error('resolveCmdInfo: subCmd is required when cmd is a number');
  }
  return CmdInfo.of(cmdOrCmdInfo, subCmd);
}
