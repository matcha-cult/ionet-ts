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

## License

AGPL-3.0
