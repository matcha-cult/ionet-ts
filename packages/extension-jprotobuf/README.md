# @nbb-ionet/extension-jprotobuf

基于 Protocol Buffers 的编解码扩展，实现 `ProtocolCodec` 接口，用于 ionet 消息的二进制序列化。

## 安装

```bash
pnpm add @nbb-ionet/extension-jprotobuf
```

## 快速开始

```typescript
import 'reflect-metadata';
import { ProtobufClass, ProtobufField, protobufCodec } from '@nbb-ionet/extension-jprotobuf';

@ProtobufClass({ name: 'LoginRequest' })
class LoginRequest {
  @ProtobufField({ tag: 1, type: 'string' })
  username: string = '';

  @ProtobufField({ tag: 2, type: 'string' })
  password: string = '';
}

// 注册类型（解码前必须注册）
protobufCodec.registerType(LoginRequest);

// 编码
const bytes = protobufCodec.encode(new LoginRequest());

// 解码
const decoded = protobufCodec.decode(bytes) as LoginRequest;
```

## 装饰器

### @ProtobufClass(options?)

标记类为 Protobuf 可序列化消息。

| 参数 | 类型 | 说明 |
|---|---|---|
| `name` | `string?` | 消息名，默认为类名 |

### @ProtobufField(options)

标记属性为 Protobuf 字段。

| 参数 | 类型 | 说明 |
|---|---|---|
| `tag` | `number` | **必填**，字段序号 |
| `type` | `string?` | 字段类型：`string` / `int32` / `int64` / `double` / `bool` / `bytes` / `message` |
| `repeated` | `boolean?` | 是否为数组字段 |
| `messageType` | `string?` | 当 type 为 `message` 时指定嵌套消息名 |

## 在 BarSkeleton 中使用

```typescript
import { BarSkeletonBuilder } from '@nbb-ionet/core-framework';
import { protobufCodec } from '@nbb-ionet/extension-jprotobuf';

const skeleton = new BarSkeletonBuilder()
  .addAction(MyAction)
  .build();

// 将 protobufCodec 传给 External Server
const wsServer = new WebSocketExternalServer({
  port: 8080,
  codec: protobufCodec,
});
```

## 编码格式

消息编码后格式为 `[1字节类型名长度][类型名UTF8字节][protobuf消息体]`，解码时据此前缀自动查找已注册类型。

## 机器可读 schema 清单（P2-1 二进制跨端契约）

线格式首段是 typeName，**解码端必须先用相同 typeName 注册类型**才能解码，否则抛
`Type <name> not registered`。为让非 TS 客户端也能实现可互操作的编解码，本包导出
与装饰器元数据**同源**的 schema 清单：

```typescript
import { ProtobufProtocolCodec } from '@nbb-ionet/extension-jprotobuf';

const codec = new ProtobufProtocolCodec();
codec.registerType(User);
codec.registerType(Message);

// 对象清单（JSON 可序列化）
const schema = codec.toSchema();
// {
//   formatVersion: 1,
//   types: [
//     { name: 'Message', fields: [
//       { name: 'content', tag: 1, type: 'string' },
//       { name: 'sender',  tag: 2, type: 'message', messageType: 'User' },
//       { name: 'tags',    tag: 3, type: 'string', repeated: true },
//     ] },
//     { name: 'User', fields: [ /* ... */ ] },
//   ],
// }

// 或 proto3 文本
const proto = codec.toProto();
```

- 也提供与 codec 无关的纯函数：`buildSchema(constructors)` / `buildProto(constructors)`，
  适合在启动时对一组类直接导出，无需先注册。
- 字段说明：`type` 为有效线类型（未声明时默认 `string`）；`type: 'message'` 时
  `messageType` 指向另一条 `types[].name`；`repeated: true` 表示数组字段。
- 输出按 typeName、tag 排序，逐字节稳定，可作为跨端契约快照纳入版本控制。
- 纯增量：不改变既有 `[1B len][typeName][payload]` 线格式与编解码行为。

## License

AGPL-3.0
