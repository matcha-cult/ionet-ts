import protobuf from 'protobufjs';
import { type ProtocolCodec } from '@nbb-ionet/core-framework';
import { getProtobufFields, getProtobufClassName, type ProtobufFieldOptions } from './decorators.js';

const root = new protobuf.Root();

export class ProtobufProtocolCodec implements ProtocolCodec {
  readonly contentType = 'application/x-protobuf';
  private typeCache = new Map<string, protobuf.Type>();

  encode(data: unknown): Uint8Array {
    if (data === null || data === undefined) {
      return new Uint8Array(0);
    }

    const constructor = data.constructor;
    const typeName = getProtobufClassName(constructor);
    const type = this.getOrCreateType(typeName, constructor);
    const message = type.create(data as any);
    const messageBytes = type.encode(message).finish();

    // Add type prefix: 1 byte length + type name bytes
    const typeBytes = new TextEncoder().encode(typeName);
    const result = new Uint8Array(1 + typeBytes.length + messageBytes.length);
    result[0] = typeBytes.length;
    result.set(typeBytes, 1);
    result.set(messageBytes, 1 + typeBytes.length);

    return result;
  }

  decode(buffer: Uint8Array | string): unknown {
    if (buffer.length === 0) {
      return null;
    }

    const uint8 = typeof buffer === 'string' ? new TextEncoder().encode(buffer) : buffer;

    // Read type prefix
    const typeLen = uint8[0];
    const typeName = new TextDecoder().decode(uint8.slice(1, 1 + typeLen));
    const messageBytes = uint8.slice(1 + typeLen);

    const type = this.typeCache.get(typeName);
    if (!type) {
      throw new Error(`Type ${typeName} not registered`);
    }

    const message = type.decode(messageBytes);
    return type.toObject(message, {
      longs: String,
      enums: String,
      bytes: String,
    });
  }

  private getOrCreateType(typeName: string, constructor: Function): protobuf.Type {
    let type = this.typeCache.get(typeName);
    if (type) {
      return type;
    }

    type = this.buildType(typeName, constructor);
    this.typeCache.set(typeName, type);
    return type;
  }

  private buildType(typeName: string, constructor: Function): protobuf.Type {
    const type = new protobuf.Type(typeName);
    const fields = getProtobufFields(constructor);

    for (const [propertyKey, options] of fields) {
      const fieldName = String(propertyKey);
      const fieldType = this.mapFieldType(options);
      const field = new protobuf.Field(fieldName, options.tag, fieldType, options.repeated ? 'repeated' : undefined);
      type.add(field);
    }

    root.add(type);
    return type;
  }

  private mapFieldType(options: ProtobufFieldOptions): string {
    if (options.type === 'message' && options.messageType) {
      return options.messageType;
    }
    return options.type ?? 'string';
  }

  registerType<T>(constructor: new (...args: any[]) => T): void {
    const typeName = getProtobufClassName(constructor);
    this.getOrCreateType(typeName, constructor);
  }
}

export const protobufCodec = new ProtobufProtocolCodec();
