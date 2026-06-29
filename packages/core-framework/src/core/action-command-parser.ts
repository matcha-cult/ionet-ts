import 'reflect-metadata';
import {
  getActionControllerCmd,
  getActionMethodSubCmds,
} from '../decorators/action-decorators.js';
import { CmdInfo } from './cmd-info.js';
import {
  type ActionCommand,
  type ActionMethodParameter,
  type ActionMethodReturn,
  ActionParameterPosition,
  createActionCommand,
} from './action-command.js';
import { ActionCommandRegions } from './action-command-region.js';
import { FlowContext } from './flow/flow-context.js';

export interface ActionParserContext {
  actionCommandRegions: ActionCommandRegions;
}

export interface ActionParserListener {
  onActionCommandParsed?(actionCommand: ActionCommand, context: ActionParserContext): void;
}

export class DefaultActionCommandParser {
  parse(
    ActionClass: Function,
    actionController: object,
    context: ActionParserContext,
    listeners: ActionParserListener[] = [],
  ): ActionCommand[] {
    const cmd = getActionControllerCmd(ActionClass);
    if (cmd === undefined) {
      throw new Error(
        `Class ${ActionClass.name} is not decorated with @ActionController`,
      );
    }

    const methodSubCmds = getActionMethodSubCmds(ActionClass);
    const region = context.actionCommandRegions.getRegion(cmd);
    const parsedCommands: ActionCommand[] = [];

    for (const [methodName, subCmd] of methodSubCmds) {
      const method = (actionController as Record<string | symbol, Function>)[
        methodName
      ];
      if (typeof method !== 'function') {
        throw new Error(
          `Method ${String(methodName)} not found on ${ActionClass.name}`,
        );
      }

      const cmdInfo = CmdInfo.of(cmd, subCmd);
      const parameters = this.extractParameters(method);
      const returnType = this.extractReturnType(method);

      const actionCommand = createActionCommand({
        cmdInfo,
        actionController,
        actionControllerClass: ActionClass,
        methodName: String(methodName),
        method,
        parameters,
        returnType,
      });

      region.add(actionCommand);
      parsedCommands.push(actionCommand);

      for (const listener of listeners) {
        listener.onActionCommandParsed?.(actionCommand, context);
      }
    }

    return parsedCommands;
  }

  private extractParameters(method: Function): ActionMethodParameter[] {
    const paramTypes: Function[] =
      Reflect.getMetadata('design:paramtypes', method) ?? [];
    const paramCount = paramTypes.length > 0 ? paramTypes.length : method.length;

    const parameters: ActionMethodParameter[] = [];
    for (let index = 0; index < paramCount; index++) {
      const type = paramTypes[index];
      let position = ActionParameterPosition.DATA;
      if (type === FlowContext || type?.name === 'FlowContext') {
        position = ActionParameterPosition.FLOW_CONTEXT;
      }

      parameters.push({
        name: `arg${index}`,
        type: type?.name,
        position,
      });
    }

    return parameters;
  }

  private extractReturnType(method: Function): ActionMethodReturn {
    const returnType: Function =
      Reflect.getMetadata('design:returntype', method) ?? Object;

    return {
      type: returnType?.name,
      isArray: returnType === Array,
    };
  }
}
