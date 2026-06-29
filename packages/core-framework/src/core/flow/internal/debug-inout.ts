import { type ActionMethodInOut } from '../action-method-inout.js';
import { type FlowContext } from '../flow-context.js';

export interface DebugInOutOptions {
  thresholdMs?: number;
  printer?: (message: string) => void;
}

export class DebugInOut implements ActionMethodInOut {
  private readonly thresholdMs: number;
  private readonly printer: (message: string) => void;

  constructor(options: DebugInOutOptions = {}) {
    this.thresholdMs = options.thresholdMs ?? 0;
    this.printer = options.printer ?? console.log;
  }

  fuckIn(flowContext: FlowContext): void {
    flowContext.getNanoTime();
  }

  fuckOut(flowContext: FlowContext): void {
    const elapsedMs = Number(process.hrtime.bigint() - flowContext.getNanoTime()) / 1_000_000;
    if (elapsedMs < this.thresholdMs) {
      return;
    }

    const cmdInfo = flowContext.getCmdInfo();
    const request = flowContext.getRequest();
    const methodResult = flowContext.getMethodResult();

    if (flowContext.hasError()) {
      this.printer(
        `[DebugInOut] Error cmd=${cmdInfo.cmd} subCmd=${cmdInfo.subCmd} ` +
          `errorCode=${flowContext.getErrorCode()} ` +
          `errorMessage=${flowContext.getErrorMessage()} ` +
          `time=${elapsedMs.toFixed(2)}ms`,
      );
    } else {
      this.printer(
        `[DebugInOut] cmd=${cmdInfo.cmd} subCmd=${cmdInfo.subCmd} ` +
          `data=${JSON.stringify(request?.data)} ` +
          `result=${JSON.stringify(methodResult)} ` +
          `time=${elapsedMs.toFixed(2)}ms`,
      );
    }
  }
}
