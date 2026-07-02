import { type FlowContext } from './flow-context.js';

export interface ActionMethodExceptionProcess {
  process(ctx: FlowContext, error: unknown): void;
}

export class DefaultActionMethodExceptionProcess implements ActionMethodExceptionProcess {
  process(ctx: FlowContext, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.setErrorCode(500);
    ctx.setErrorMessage(errorMessage);
  }
}

export class LogActionMethodExceptionProcess implements ActionMethodExceptionProcess {
  process(ctx: FlowContext, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.setErrorCode(500);
    ctx.setErrorMessage(errorMessage);
    console.error('[ActionException]', error);
  }
}
