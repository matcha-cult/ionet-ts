import { CmdInfo } from './cmd-info.js';
import { type ActionCommand } from './action-command.js';
import { ActionCommandRegions } from './action-command-region.js';
import { DefaultActionCommandParser } from './action-command-parser.js';
import { FlowContext, runWithFlowContext } from './flow/flow-context.js';
import { InOutChain, type ActionMethodInOut } from './flow/action-method-inout.js';

export interface BarSkeletonSetting {
  printSlow?: boolean;
  slowThresholdMs?: number;
}

export interface BarSkeletonOptions {
  setting?: BarSkeletonSetting;
  inOuts?: ActionMethodInOut[];
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

  async execute(request: {
    cmd: number;
    subCmd: number;
    data?: unknown;
  }): Promise<{ data?: unknown; errorCode?: number; errorMessage?: string }> {
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

    return runWithFlowContext(ctx, async () => {
      this.inOutChain.fuckInAll(ctx);
      try {
        const result = await this.invokeAction(actionCommand, ctx, request.data);
        ctx.setMethodResult(result);
        this.inOutChain.fuckOutAll(ctx);
        return { data: result };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        ctx.setErrorCode(500);
        ctx.setErrorMessage(errorMessage);
        this.inOutChain.fuckOutAll(ctx);
        return { errorCode: 500, errorMessage };
      }
    });
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
