import 'reflect-metadata';
import {
  ActionController,
  ActionMethod,
  CmdInfo,
  ACTION_CONTROLLER_METADATA,
  ACTION_METHOD_METADATA,
} from '@nbb-ionet/core-framework';

export interface ActionMethodInfo {
  methodName: string;
  subCmd: number;
  parameterTypes: string[];
  returnType: string;
}

export interface ActionCommandInfo {
  cmd: number;
  controllerName: string;
  methods: ActionMethodInfo[];
}

export function scanActions(actions: Function[]): ActionCommandInfo[] {
  const result: ActionCommandInfo[] = [];

  for (const action of actions) {
    const cmd = Reflect.getMetadata(ACTION_CONTROLLER_METADATA, action);
    if (cmd === undefined) continue;

    const methods: ActionMethodInfo[] = [];

    // Get method metadata from the constructor
    const methodMetadata = Reflect.getOwnMetadata(ACTION_METHOD_METADATA, action) as Map<string | symbol, number> | undefined;
    if (!methodMetadata) continue;

    const proto = action.prototype;

    for (const [methodName, subCmd] of methodMetadata) {
      const paramTypes = Reflect.getMetadata('design:paramtypes', proto, String(methodName)) ?? [];
      const returnType = Reflect.getMetadata('design:returntype', proto, String(methodName));

      methods.push({
        methodName: String(methodName),
        subCmd,
        parameterTypes: paramTypes.map((t: Function) => t.name),
        returnType: returnType?.name ?? 'void',
      });
    }

    if (methods.length > 0) {
      result.push({
        cmd,
        controllerName: action.name,
        methods,
      });
    }
  }

  return result;
}
