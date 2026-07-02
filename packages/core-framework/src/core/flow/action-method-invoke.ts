import { type ActionCommand } from '../action-command.js';
import { type FlowContext } from './flow-context.js';

export interface ActionMethodInvoke {
  invoke(
    actionCommand: ActionCommand,
    ctx: FlowContext,
    data: unknown,
  ): Promise<unknown>;
}

export class DefaultActionMethodInvoke implements ActionMethodInvoke {
  async invoke(
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
