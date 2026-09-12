import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  ProtobufClass,
  ProtobufField,
  ProtobufProtocolCodec,
  getProtobufFields,
  getProtobufClassName,
  buildSchema,
  buildProto,
  PROTOBUF_SCHEMA_FORMAT_VERSION,
} from '../src/index.js';

@ProtobufClass()
class User {
  @ProtobufField({ tag: 1, type: 'string' })
  name!: string;

  @ProtobufField({ tag: 2, type: 'int32' })
  age!: number;

  @ProtobufField({ tag: 3, type: 'bool' })
  active!: boolean;
}

@ProtobufClass()
class Message {
  @ProtobufField({ tag: 1, type: 'string' })
  content!: string;

  @ProtobufField({ tag: 2, type: 'message', messageType: 'User' })
  sender?: User;

  @ProtobufField({ tag: 3, type: 'string', repeated: true })
  tags!: string[];
}

/** 缺省 type（应回退 string）、无字段类型、自定义 name。 */
@ProtobufClass()
class Defaults {
  @ProtobufField({ tag: 1 })
  note!: string;
}

@ProtobufClass()
class Empty {
  // 无字段
}

@ProtobufClass({ name: 'Renamed' })
class Original {
  @ProtobufField({ tag: 9, type: 'double' })
  value!: number;
}

/** 故意不注册，用于验证「注册即契约键」。 */
@ProtobufClass()
class Never {
  @ProtobufField({ tag: 1, type: 'string' })
  x!: string;
}

describe('buildSchema（P2-1 机器可读契约）', () => {
  it('导出 formatVersion 与 types（按 name 升序、fields 按 tag 升序）', () => {
    const schema = buildSchema([Message, User, Defaults, Empty, Original]);

    expect(schema.formatVersion).toBe(PROTOBUF_SCHEMA_FORMAT_VERSION);
    expect(schema.types.map((t) => t.name)).toEqual([
      'Defaults',
      'Empty',
      'Message',
      'Renamed',
      'User',
    ]);

    const message = schema.types.find((t) => t.name === 'Message')!;
    expect(message.fields.map((f) => f.name)).toEqual(['content', 'sender', 'tags']);
    expect(message.fields.map((f) => f.tag)).toEqual([1, 2, 3]);
  });

  it('schema 与 getProtobufFields 元数据逐字段一致（name/tag/type/repeated/messageType）', () => {
    const constructors = [Message, User, Defaults, Empty, Original];
    const schema = buildSchema(constructors);
    const byName = new Map(schema.types.map((t) => [t.name, t]));

    for (const constructor of constructors) {
      const typeName = getProtobufClassName(constructor);
      const type = byName.get(typeName)!;
      const metadata = getProtobufFields(constructor);

      expect(type.fields.length).toBe(metadata.size);

      for (const field of type.fields) {
        const options = metadata.get(field.name);
        expect(options, `metadata missing for ${typeName}.${field.name}`).toBeDefined();
        expect(field.tag).toBe(options!.tag);
        expect(field.type).toBe(options!.type ?? 'string');
        expect(field.repeated).toBe(options!.repeated ? true : undefined);
        expect(field.messageType).toBe(options!.messageType);
      }
    }
  });

  it('message 嵌套引用：type=message + messageType 指向已注册 type', () => {
    const schema = buildSchema([Message, User]);
    const message = schema.types.find((t) => t.name === 'Message')!;
    const sender = message.fields.find((f) => f.name === 'sender')!;

    expect(sender).toEqual({ name: 'sender', tag: 2, type: 'message', messageType: 'User' });
    // 被引用的类型本身也出现在清单里（其 name 即解码注册键）
    expect(schema.types.some((t) => t.name === 'User')).toBe(true);
  });

  it('repeated 字段带 repeated:true', () => {
    const schema = buildSchema([Message]);
    const tags = schema.types[0].fields.find((f) => f.name === 'tags')!;
    expect(tags).toEqual({ name: 'tags', tag: 3, type: 'string', repeated: true });
    // 非 repeated 字段不出现 repeated 键
    const content = schema.types[0].fields.find((f) => f.name === 'content')!;
    expect('repeated' in content).toBe(false);
  });

  it('缺省 type 回退为 string', () => {
    const schema = buildSchema([Defaults]);
    expect(schema.types[0].fields[0]).toEqual({ name: 'note', tag: 1, type: 'string' });
  });

  it('无字段类型导出空 fields', () => {
    const schema = buildSchema([Empty]);
    expect(schema.types).toEqual([{ name: 'Empty', fields: [] }]);
  });

  it('@ProtobufClass({ name }) 的自定义 typeName 被采用', () => {
    const schema = buildSchema([Original]);
    expect(schema.types[0].name).toBe('Renamed');
    expect(schema.types[0].fields[0]).toEqual({ name: 'value', tag: 9, type: 'double' });
  });

  it('同 typeName 只保留首次出现', () => {
    const schema = buildSchema([Original, Original]);
    expect(schema.types).toHaveLength(1);
  });

  it('输出可 JSON 序列化（机器可读）', () => {
    const schema = buildSchema([Message, User, Defaults, Empty, Original]);
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});

describe('buildSchema / buildProto 输出稳定', () => {
  it('类型注册顺序无关（按 name/tag 排序）', () => {
    expect(buildSchema([User, Message])).toEqual(buildSchema([Message, User]));
    expect(buildProto([User, Message])).toBe(buildProto([Message, User]));
  });

  it('toProto 生成 proto3 文本（含嵌套引用与 repeated）', () => {
    const proto = buildProto([Message, User]);
    expect(proto).toContain('syntax = "proto3";');
    expect(proto).toContain('message User {');
    expect(proto).toContain('  string name = 1;');
    expect(proto).toContain('  int32 age = 2;');
    expect(proto).toContain('message Message {');
    expect(proto).toContain('  User sender = 2;');
    expect(proto).toContain('  repeated string tags = 3;');
  });
});

describe('ProtobufProtocolCodec.toSchema / toProto', () => {
  // 编解码器的 protobuf.Root 是模块级的（既有实现）：同一模块内一个 typeName 只能
  // buildType 一次。因此共用同一实例覆盖两个出口，避免触发与本次改动无关的重复注册。
  const codec = new ProtobufProtocolCodec();
  codec.registerType(User);
  codec.registerType(Message);

  it('toSchema 只包含已注册类型，且与 buildSchema 一致', () => {
    const schema = codec.toSchema();
    expect(schema).toEqual(buildSchema([User, Message]));
    expect(schema.types.map((t) => t.name)).toEqual(['Message', 'User']);
  });

  it('未注册类型不出现在 schema 中（注册即契约键）', () => {
    expect(codec.toSchema().types.some((t) => t.name === 'Never')).toBe(false);
    // 纯函数路径可以看到它，证明缺席仅因未注册
    expect(buildSchema([Never]).types.map((t) => t.name)).toEqual(['Never']);
  });

  it('toProto 与纯函数出口一致', () => {
    expect(codec.toProto()).toBe(buildProto([User, Message]));
  });
});
