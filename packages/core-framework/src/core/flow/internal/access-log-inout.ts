import { type ActionMethodInOut } from '../action-method-inout.js';
import { type FlowContext } from '../flow-context.js';

export interface AccessLogOptions {
  printer?: (message: string) => void;
  format?: 'combined' | 'common' | 'custom';
  customFormat?: (ctx: FlowContext, elapsedMs: number) => string;
}

export class AccessLogInOut implements ActionMethodInOut {
  private readonly printer: (message: string) => void;
  private readonly format: string;
  private readonly customFormat?: (ctx: FlowContext, elapsedMs: number) => string;

  constructor(options: AccessLogOptions = {}) {
    this.printer = options.printer ?? console.log;
    this.format = options.format ?? 'combined';
    this.customFormat = options.customFormat;
  }

  fuckIn(flowContext: FlowContext): void {
    flowContext.getNanoTime();
  }

  fuckOut(flowContext: FlowContext): void {
    const elapsedMs = Number(process.hrtime.bigint() - flowContext.getNanoTime()) / 1_000_000;

    let logLine: string;
    if (this.customFormat) {
      logLine = this.customFormat(flowContext, elapsedMs);
    } else {
      logLine = this.formatLog(flowContext, elapsedMs);
    }

    this.printer(logLine);
  }

  private formatLog(ctx: FlowContext, elapsedMs: number): string {
    const cmdInfo = ctx.getCmdInfo();
    const server = ctx.getServer();
    const userId = ctx.getUserId();
    const errorCode = ctx.getErrorCode();
    const timestamp = new Date().toISOString();

    if (this.format === 'common') {
      return `${timestamp} ${cmdInfo.cmd}-${cmdInfo.subCmd} user=${userId} status=${errorCode || 200} time=${elapsedMs.toFixed(2)}ms`;
    }

    return `${timestamp} [${server?.type ?? 'unknown'}:${server?.port ?? 0}] ${cmdInfo.cmd}-${cmdInfo.subCmd} user=${userId} status=${errorCode || 200} time=${elapsedMs.toFixed(2)}ms server=${server?.id ?? 'unknown'}`;
  }
}
