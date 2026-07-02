import 'reflect-metadata';

const PROTOBUF_CLASS_KEY = Symbol('protobuf:class');
const PROTOBUF_FIELD_KEY = Symbol('protobuf:field');

export interface ProtobufFieldOptions {
  tag: number;
  type?: 'string' | 'int32' | 'int64' | 'double' | 'bool' | 'bytes' | 'message';
  repeated?: boolean;
  messageType?: string;
}

export interface ProtobufClassOptions {
  name?: string;
}

export function ProtobufClass(options?: ProtobufClassOptions): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(PROTOBUF_CLASS_KEY, {
      name: options?.name ?? target.name,
    }, target);
  };
}

export function ProtobufField(options: ProtobufFieldOptions): PropertyDecorator {
  return (target, propertyKey) => {
    const fields: Map<string | symbol, ProtobufFieldOptions> =
      Reflect.getMetadata(PROTOBUF_FIELD_KEY, target.constructor) ?? new Map();
    fields.set(propertyKey, options);
    Reflect.defineMetadata(PROTOBUF_FIELD_KEY, fields, target.constructor);
  };
}

export function getProtobufFields(target: Function): Map<string | symbol, ProtobufFieldOptions> {
  return Reflect.getMetadata(PROTOBUF_FIELD_KEY, target) ?? new Map();
}

export function getProtobufClassName(target: Function): string {
  const meta = Reflect.getMetadata(PROTOBUF_CLASS_KEY, target);
  return meta?.name ?? target.name;
}
