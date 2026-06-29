import { CmdInfo } from '../cmd-info.js';
import { FlowContext } from './flow-context.js';

export class EmptyFlowContext extends FlowContext {
  constructor() {
    super();
    this.setCmdInfo(CmdInfo.of(0, 0));
  }
}

export const emptyFlowContext = new EmptyFlowContext();
