/**
 * 机器可读的 Protobuf schema 清单（P2-1 二进制跨端契约）。
 *
 * 本模块与编解码器**共享同一份装饰器元数据**（{@link getProtobufFields} /
 * {@link getProtobufClassName}），不手工维护第二份真相，因此不会与线格式漂移。
 *
 * ## typeName 注册约定（跨语言客户端必读）
 *
 * 线格式为 `[1 字节 typeName 长度][typeName UTF-8][protobuf 载荷]`
 * （见 `protobuf-codec.ts`）。解码端必须**先用相同的 typeName 注册类型**
 * （`ProtobufProtocolCodec.registerType`）才能解码，否则抛
 * `Type <name> not registered`。
 *
 * 本 schema 的 `types[].name` 即该 typeName，`types[].fields[]` 给出每个字段的
 * tag / 线类型 / repeated / 嵌套 messageType。非 TS 客户端可据本 schema 生成
 * 等价的类型注册表，再实现 protobuf 读写，从而与 TS 端互操作。
 *
 * ## 稳定性
 *
 * `buildSchema` 对 `types` 按 name 升序、每个 type 的 `fields` 按 tag 升序排列，
 * 因此同一组类型无论注册顺序如何，输出都逐字节稳定，适合做跨端契约快照。
 */

import {
  getProtobufClassName,
  getProtobufFields,
  type ProtobufFieldOptions,
} from './decorators.js';

/** schema 清单格式版本；出现不兼容变更时递增。 */
export const PROTOBUF_SCHEMA_FORMAT_VERSION = 1;

/** 单个字段的机器可读描述。 */
export interface ProtobufSchemaField {
  /** 字段名（装饰器所在的属性名）。 */
  name: string;
  /** 字段序号（protobuf tag）。 */
  tag: number;
  /** 有效线类型；未显式声明时默认 `'string'`（与编解码器一致）；message 引用时为 `'message'`。 */
  type: string;
  /** 是否重复（数组）字段；仅在 true 时出现。 */
  repeated?: boolean;
  /** 当 `type === 'message'` 时指向的另一个已注册 typeName。 */
  messageType?: string;
}

/** 单个消息类型的机器可读描述。 */
export interface ProtobufSchemaType {
  /** typeName，与线格式前缀、注册键一致。 */
  name: string;
  fields: ProtobufSchemaField[];
}

/** 机器可读 schema 清单。 */
export interface ProtobufSchema {
  /** 清单格式版本，见 {@link PROTOBUF_SCHEMA_FORMAT_VERSION}。 */
  formatVersion: number;
  types: ProtobufSchemaType[];
}

/**
 * 把装饰器元数据里的 `type` 解析为有效线类型。
 * 缺省 `type` 时与编解码器 `mapFieldType` 保持一致，回退为 `'string'`。
 */
function resolveFieldType(options: ProtobufFieldOptions): string {
  return options.type ?? 'string';
}

/** 由单个类的装饰器元数据构造字段清单（按 tag 升序）。 */
export function buildSchemaFields(constructor: Function): ProtobufSchemaField[] {
  const fields = getProtobufFields(constructor);
  const result: ProtobufSchemaField[] = [];

  for (const [propertyKey, options] of fields) {
    const field: ProtobufSchemaField = {
      name: String(propertyKey),
      tag: options.tag,
      type: resolveFieldType(options),
    };
    if (options.repeated) {
      field.repeated = true;
    }
    if (options.messageType) {
      field.messageType = options.messageType;
    }
    result.push(field);
  }

  result.sort((a, b) => a.tag - b.tag);
  return result;
}

/**
 * 由一组类构造机器可读 schema 清单。
 *
 * 同 typeName 只保留首次出现的类；输出按 typeName 升序、字段按 tag 升序，稳定可快照。
 * 嵌套 `message` 字段通过 `messageType` 指向另一条 type 记录——只要该类型也在
 * `constructors` 中，就会同时出现在 `types` 里。
 */
export function buildSchema(constructors: Iterable<Function>): ProtobufSchema {
  const byName = new Map<string, ProtobufSchemaType>();

  for (const constructor of constructors) {
    const name = getProtobufClassName(constructor);
    if (byName.has(name)) {
      continue;
    }
    byName.set(name, { name, fields: buildSchemaFields(constructor) });
  }

  const types = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { formatVersion: PROTOBUF_SCHEMA_FORMAT_VERSION, types };
}

/** 生成 `.proto`（proto3）文本；与 {@link buildSchema} 同源，供跨语言工具链使用。 */
export function buildProto(constructors: Iterable<Function>): string {
  const schema = buildSchema(constructors);
  const lines: string[] = ['syntax = "proto3";', ''];

  for (const type of schema.types) {
    lines.push(`message ${type.name} {`);
    for (const field of type.fields) {
      const protoType = field.type === 'message' ? (field.messageType ?? 'string') : field.type;
      const label = field.repeated ? 'repeated ' : '';
      lines.push(`  ${label}${protoType} ${field.name} = ${field.tag};`);
    }
    lines.push('}', '');
  }

  return lines.join('\n');
}
