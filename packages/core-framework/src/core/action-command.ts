import { CmdInfo } from './cmd-info.js';

export interface ActionMethodParameter {
  name: string;
  type?: string;
  position: ActionParameterPosition;
}

export enum ActionParameterPosition {
  FLOW_CONTEXT = 'FLOW_CONTEXT',
  DATA = 'DATA',
  OTHER = 'OTHER',
}

export interface ActionMethodReturn {
  type?: string;
  isArray: boolean;
}

export interface ActionCommand {
  readonly cmdInfo: CmdInfo;
  readonly actionController: object;
  readonly actionControllerClass: Function;
  readonly methodName: string;
  readonly method: Function;
  readonly actionMethodParameters: ActionMethodParameter[];
  readonly actionMethodReturn: ActionMethodReturn;
}

export function createActionCommand(options: {
  cmdInfo: CmdInfo;
  actionController: object;
  actionControllerClass: Function;
  methodName: string;
  method: Function;
  parameters: ActionMethodParameter[];
  returnType: ActionMethodReturn;
}): ActionCommand {
  return {
    cmdInfo: options.cmdInfo,
    actionController: options.actionController,
    actionControllerClass: options.actionControllerClass,
    methodName: options.methodName,
    method: options.method,
    actionMethodParameters: options.parameters,
    actionMethodReturn: options.returnType,
  };
}
