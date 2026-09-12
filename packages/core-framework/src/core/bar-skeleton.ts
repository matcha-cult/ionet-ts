import { CmdInfo } from './cmd-info.js';
import { type ActionCommand } from './action-command.js';
import { ActionCommandRegions } from './action-command-region.js';
import { DefaultActionCommandParser } from './action-command-parser.js';
import { FlowContext, runWithFlowContext, type Request } from './flow/flow-context.js';
import { InOutChain, type ActionMethodInOut } from './flow/action-method-inout.js';

export interface BarSkeletonSetting {
  printSlow?: boolean;
  slowThresholdMs?: number;
}

export interface BarSkeletonOptions {
  setting?: BarSkeletonSetting;
  inOuts?: ActionMethodInOut[];
}

/**
 * execute 的可选观测钩子。用于在不改变返回信封的前提下，让外部服感知本次执行的
 * FlowContext 与最终绑定的 userId（连接注册表 / 定向推送接线用）。
 *
 * 取舍（任务 1）：在 (a) execute hooks、(b) executeWithContext 返回 { response, userId }、
 * (c) 外部服注册内部 InOut 三种方案中选 (a)：
 * - 返回值与既有签名零变化，向后兼容最强；
 * - 无需外部服接触 InOut 链内部；
 * - 不影响无钩子的既有调用点（全部 TS 编译期可选）。
 */
export interface BarSkeletonExecuteHooks {
  /** FlowContext 创建并写入 request 后立即调用（inOut/Action 执行之前）。 */
  onFlowContext?(ctx: FlowContext): void;
  /** 本次执行结束时 userId !== 0n 才会调用（成功、失败两条路径都会触发）。 */
  onBound?(userId: bigint): void;
}

export class BarSkeleton {
  readonly actionCommandRegions: ActionCommandRegions;
  readonly inOutChain: InOutChain;
  private readonly setting: BarSkeletonSetting;
  private readonly actionCommandParser = new DefaultActionCommandParser();

  constructor(
    actionCommandRegions: ActionCommandRegions,
    setting: BarSkeletonSetting = {},
    inOuts: ActionMethodInOut[] = [],
  ) {
    this.actionCommandRegions = actionCommandRegions;
    this.setting = {
      printSlow: setting.printSlow ?? false,
      slowThresholdMs: setting.slowThresholdMs ?? 100,
    };
    this.inOutChain = new InOutChain();
    for (const inOut of inOuts) {
      this.inOutChain.add(inOut);
    }
  }

  /**
   * 注册单个 Action 类到路由表。可在构建后追加注册（如 NestJS feature 模块场景）。
   * 未传 instance 时直接 new ActionClass() 实例化（不经过外部 DI 容器）。
   */
  addAction(ActionClass: Function, instance?: object): void {
    const controllerInstance = instance ?? new (ActionClass as new () => object)();
    this.actionCommandParser.parse(ActionClass, controllerInstance, {
      actionCommandRegions: this.actionCommandRegions,
    });
  }

  async execute(
    request: Request,
    hooks?: BarSkeletonExecuteHooks,
  ): Promise<{ data?: unknown; errorCode?: number; errorMessage?: string }> {
    const cmdInfo = CmdInfo.of(request.cmd, request.subCmd);
    const actionCommand = this.actionCommandRegions.getActionCommand(cmdInfo);

    if (!actionCommand) {
      return {
        errorCode: 404,
        errorMessage: `Action not found for cmd=${request.cmd}, subCmd=${request.subCmd}`,
      };
    }

    const ctx = new FlowContext();
    ctx.setCmdInfo(cmdInfo);
    ctx.setRequest(request);
    hooks?.onFlowContext?.(ctx);

    return runWithFlowContext(ctx, async () => {
      this.inOutChain.fuckInAll(ctx);
      try {
        const result = await this.invokeAction(actionCommand, ctx, request.data);
        ctx.setMethodResult(result);
        this.inOutChain.fuckOutAll(ctx);
        this.notifyBound(ctx, hooks);
        return { data: result };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        ctx.setErrorCode(500);
        ctx.setErrorMessage(errorMessage);
        this.inOutChain.fuckOutAll(ctx);
        this.notifyBound(ctx, hooks);
        return { errorCode: 500, errorMessage };
      }
    });
  }

  /** userId === 0n 视为未绑定，不得向外报告（任务 1 硬约束）。 */
  private notifyBound(ctx: FlowContext, hooks?: BarSkeletonExecuteHooks): void {
    const userId = ctx.getUserId();
    if (userId !== 0n) {
      hooks?.onBound?.(userId);
    }
  }

  private async invokeAction(
    actionCommand: ActionCommand,
    ctx: FlowContext,
    data: unknown,
  ): Promise<unknown> {
    const { method, actionController, actionMethodParameters } = actionCommand;
    const args: unknown[] = [];

    let dataPassed = false;
    for (const param of actionMethodParameters) {
      if (param.position === 'FLOW_CONTEXT') {
        args.push(ctx);
      } else if (param.position === 'DATA' && !dataPassed) {
        args.push(data);
        dataPassed = true;
      } else {
        args.push(undefined);
      }
    }

    const boundMethod = (method as Function).bind(actionController);
    return boundMethod(...args);
  }
}

export class BarSkeletonBuilder {
  private readonly actionClasses: Array<{
    ActionClass: Function;
    instance?: object;
  }> = [];
  private readonly inOuts: ActionMethodInOut[] = [];
  private setting: BarSkeletonSetting = {};

  addAction(ActionClass: Function, instance?: object): this {
    this.actionClasses.push({ ActionClass, instance });
    return this;
  }

  addInOut(inOut: ActionMethodInOut): this {
    this.inOuts.push(inOut);
    return this;
  }

  setSetting(setting: BarSkeletonSetting): this {
    this.setting = setting;
    return this;
  }

  build(): BarSkeleton {
    const skeleton = new BarSkeleton(new ActionCommandRegions(), this.setting, this.inOuts);

    for (const { ActionClass, instance } of this.actionClasses) {
      skeleton.addAction(ActionClass, instance);
    }

    return skeleton;
  }
}
