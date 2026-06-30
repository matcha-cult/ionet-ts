import { CmdInfo } from '../cmd-info.js';
import { FlowContext } from './flow-context.js';

export interface FlowContextCreateOptions {
  cmdInfo?: CmdInfo;
  userId?: bigint;
}

export function createFlowContext(options: FlowContextCreateOptions = {}): FlowContext {
  const ctx = new FlowContext();
  if (options.cmdInfo) {
    ctx.setCmdInfo(options.cmdInfo);
  }
  if (options.userId !== undefined) {
    ctx.setUserId(options.userId);
  }
  return ctx;
}
