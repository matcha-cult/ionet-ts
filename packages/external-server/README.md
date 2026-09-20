# @nbb-ionet/external-server

ionet External Server 实现 — HTTP 和 WebSocket 协议适配，将客户端请求路由到 BarSkeleton 执行。

## 安装

```bash
pnpm add @nbb-ionet/external-server
```

## HttpExternalServer

HTTP 协议适配，URL 路径格式为 `/{prefix}/{cmd}/{subCmd}`。

```typescript
import { BarSkeletonBuilder } from '@nbb-ionet/core-framework';
import { HttpExternalServer } from '@nbb-ionet/external-server';

const skeleton = new BarSkeletonBuilder()
  .addAction(HallAction)
  .build();

const http = new HttpExternalServer({
  port: 8080,
  pathPrefix: '/api', // 默认值
});

await http.start(skeleton);
// POST http://localhost:8080/api/1/1
// Body: { "name": "World" }
```

### 路由规则

| URL | 解析结果 |
|---|---|
| `/api/1/1` | cmd=1, subCmd=1 |
| `/api/1/2` | cmd=1, subCmd=2 |

请求体经 codec 解码后作为 Action 参数传入。

## WebSocketExternalServer

WebSocket 长连接适配，内置心跳检测。

```typescript
import { WebSocketExternalServer } from '@nbb-ionet/external-server';

const ws = new WebSocketExternalServer({
  port: 9090,
  path: '/ws',             // 默认值
  heartbeatInterval: 30000, // 默认值 (ms)
});

await ws.start(skeleton);

// 客户端发送 JSON 消息:
// { "cmd": 1, "subCmd": 1, "data": { ... } }
```

### 广播与定向推送

```typescript
// 广播给所有连接
ws.broadcast({ type: 'server:tick', time: Date.now() });

// 排除某个连接
ws.broadcast({ type: 'update' }, excludeSocket);

// 定向推送给指定用户（需先绑定 userId）
ws.sendTo(100n, { type: 'notification', text: '你有新消息' });

ws.clientCount; // 当前连接数
```

## BaseExternalServer

抽象基类，可用于自定义协议适配。

```typescript
import { BaseExternalServer } from '@nbb-ionet/external-server';

class MyCustomServer extends BaseExternalServer {
  readonly protocol = 'custom';

  async start(skeleton) {
    this.skeleton = skeleton;
    // 自定义协议启动逻辑
  }

  async stop() {
    // 清理逻辑
  }
}
```

## Codec

默认使用 JSON 编解码，可替换为 Protobuf 等：

```typescript
import { protobufCodec } from '@nbb-ionet/extension-jprotobuf';

const ws = new WebSocketExternalServer({
  port: 9090,
  codec: protobufCodec,
});
```

## License

AGPL-3.0
