import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ProtobufClass, ProtobufField, ProtobufProtocolCodec } from '../src/index.js';

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

describe('ProtobufProtocolCodec', () => {
  const codec = new ProtobufProtocolCodec();

  describe('基础类型编解码', () => {
    it('应该正确编解码基础类型', () => {
      const user = new User();
      user.name = 'Alice';
      user.age = 30;
      user.active = true;

      codec.registerType(User);

      const encoded = codec.encode(user);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('应该处理空数据', () => {
      const encoded = codec.encode(null);
      expect(encoded).toEqual(new Uint8Array(0));
    });

    it('应该处理空缓冲区', () => {
      const decoded = codec.decode(new Uint8Array(0));
      expect(decoded).toBeNull();
    });
  });

  describe('嵌套消息编解码', () => {
    it('应该正确处理嵌套消息', () => {
      const message = new Message();
      message.content = 'Hello';
      message.tags = ['greeting', 'test'];

      codec.registerType(Message);
      codec.registerType(User);

      const encoded = codec.encode(message);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe('数组字段编解码', () => {
    it('应该正确处理数组字段', () => {
      const message = new Message();
      message.content = 'Test';
      message.tags = ['tag1', 'tag2', 'tag3'];

      codec.registerType(Message);

      const encoded = codec.encode(message);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe('与 JSON 编解码对比', () => {
    it('Protobuf 编码应该比 JSON 更小', () => {
      const user = new User();
      user.name = 'Alice';
      user.age = 30;
      user.active = true;

      codec.registerType(User);

      const protobufEncoded = codec.encode(user);
      const jsonEncoded = JSON.stringify(user);

      expect(protobufEncoded.length).toBeLessThan(jsonEncoded.length);
    });
  });
});

describe('装饰器', () => {
  it('应该正确标记 Protobuf 类', () => {
    @ProtobufClass({ name: 'CustomName' })
    class TestClass {}

    const name = getProtobufClassName(TestClass);
    expect(name).toBe('CustomName');
  });

  it('应该正确标记 Protobuf 字段', () => {
    @ProtobufClass()
    class TestClass {
      @ProtobufField({ tag: 1, type: 'string' })
      name!: string;

      @ProtobufField({ tag: 2, type: 'int32' })
      age!: number;
    }

    const fields = getProtobufFields(TestClass);
    expect(fields.size).toBe(2);
    expect(fields.get('name')).toEqual({ tag: 1, type: 'string' });
    expect(fields.get('age')).toEqual({ tag: 2, type: 'int32' });
  });
});

import { getProtobufClassName, getProtobufFields } from '../src/decorators.js';
