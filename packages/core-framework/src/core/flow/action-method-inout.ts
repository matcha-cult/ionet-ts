import { type FlowContext } from './flow-context.js';

export interface ActionMethodInOut {
  fuckIn(flowContext: FlowContext): void;
  fuckOut(flowContext: FlowContext): void;
}

export class InOutChain {
  private readonly inOuts: ActionMethodInOut[] = [];

  add(inOut: ActionMethodInOut): void {
    this.inOuts.push(inOut);
  }

  fuckInAll(flowContext: FlowContext): void {
    for (const inOut of this.inOuts) {
      inOut.fuckIn(flowContext);
    }
  }

  fuckOutAll(flowContext: FlowContext): void {
    for (const inOut of this.inOuts) {
      inOut.fuckOut(flowContext);
    }
  }

  get size(): number {
    return this.inOuts.length;
  }
}
