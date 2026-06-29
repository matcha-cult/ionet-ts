import 'reflect-metadata';

export const ACTION_CONTROLLER_METADATA = 'ionet:action_controller';
export const ACTION_METHOD_METADATA = 'ionet:action_method';

export function ActionController(cmd: number): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(ACTION_CONTROLLER_METADATA, cmd, target);
  };
}

export function ActionMethod(subCmd: number): MethodDecorator {
  return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const existingMethods: Map<string | symbol, number> =
      Reflect.getOwnMetadata(ACTION_METHOD_METADATA, target.constructor) ?? new Map();
    existingMethods.set(propertyKey, subCmd);
    Reflect.defineMetadata(ACTION_METHOD_METADATA, existingMethods, target.constructor);
    return descriptor;
  };
}

export function getActionControllerCmd(target: Function): number | undefined {
  return Reflect.getMetadata(ACTION_CONTROLLER_METADATA, target);
}

export function getActionMethodSubCmds(target: Function): Map<string | symbol, number> {
  return Reflect.getOwnMetadata(ACTION_METHOD_METADATA, target) ?? new Map();
}
