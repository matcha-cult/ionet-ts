import { type FlowContext } from './flow-context.js';

export interface ActionAfter {
  after(ctx: FlowContext): void | Promise<void>;
}

export class DefaultActionAfter implements ActionAfter {
  after(_ctx: FlowContext): void {
    // No-op by default
  }
}

export class LoggingActionAfter implements ActionAfter {
  after(ctx: FlowContext): void {
    const cmdInfo = ctx.getCmdInfo();
    if (ctx.hasError()) {
      console.log(
        `[ActionAfter] cmd=${cmdInfo.cmd} subCmd=${cmdInfo.subCmd} error=${ctx.getErrorMessage()}`,
      );
    } else {
      console.log(
        `[ActionAfter] cmd=${cmdInfo.cmd} subCmd=${cmdInfo.subCmd} success`,
      );
    }
  }
}
