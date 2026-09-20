# @nbb-ionet/redis

ionet Redis 基础设施层 — 提供 IPC 通信、会话存储、分布式锁、分布式广播与分布式房间。

## 安装

```bash
pnpm add @nbb-ionet/redis
```

## 核心组件

### RedisClient — 连接管理

封装 ioredis，管理 pub/sub 双连接，提供自动重连与状态追踪。

```typescript
import { RedisClient } from '@nbb-ionet/redis';

const client = new RedisClient({
  host: '127.0.0.1',
  port: 6379,
  keyPrefix: 'myapp:',
});

await client.connect();
await client.ping(); // true

const off = client.onStatusChange((status) => {
  console.log('Redis status:', status); // connected | disconnected | reconnecting
});

await client.disconnect();
```

### RedisPubSub — 发布/订阅

支持频道订阅和模式匹配订阅（`psubscribe`）。

```typescript
import { RedisPubSub } from '@nbb-ionet/redis';

const pubSub = new RedisPubSub(client);
await pubSub.connect();

await pubSub.subscribe('chat:room1', (channel, message) => {
  console.log(channel, message.payload);
});

await pubSub.publish('chat:room1', { text: 'hello' });

// 模式订阅
await pubSub.psubscribe('chat:*', (channel, message) => { ... });
```

### RedisSessionStore — 会话存储

实现 `SessionStore` 接口，支持 TTL 自动过期，自动序列化 bigint 和 Map。

```typescript
import { RedisSessionStore } from '@nbb-ionet/redis';

const store = new RedisSessionStore(client, {
  keyPrefix: 'session:',
  defaultTtl: 86400, // 24h
});

await store.set('sid1', { userId: 100n, data: new Map() });
const session = await store.get('sid1');
await store.delete('sid1');
```

### DistributedLock — 分布式锁

基于 Redis SET NX + Lua 脚本的安全分布式锁，支持看门狗自动续期。

```typescript
import { DistributedLock } from '@nbb-ionet/redis';

const lock = new DistributedLock(client, {
  defaultTtlMs: 30_000,
  watchdogIntervalMs: 10_000,
});

// 一次性获取
if (await lock.acquire('order:123')) {
  try {
    // 临界区
  } finally {
    await lock.release('order:123');
  }
}

// 带重试
const acquired = await lock.acquireWithRetry('order:123', 5000);

// 看门狗自动续期（适合长任务）
await lock.acquire('task:1', 10_000);
lock.startWatchdog('task:1', 10_000);
// ... 任务完成后
lock.stopWatchdog('task:1');
await lock.release('task:1');
```

### DistributedBroadcaster — 分布式广播

跨实例消息广播和用户定向消息，基于 Redis Pub/Sub。

```typescript
import { DistributedBroadcaster, RedisPubSub } from '@nbb-ionet/redis';

const pubSub = new RedisPubSub(client);
const broadcaster = new DistributedBroadcaster(client, pubSub);
await broadcaster.start();

// 注册本地用户
broadcaster.registerLocalUser('user1', (data) => {
  console.log('received:', data);
});

// 广播给所有在线用户（跨实例）
await broadcaster.broadcastToAll({ type: 'announcement', text: '维护通知' });

// 定向消息
await broadcaster.broadcastToUser('user1', { type: 'notification', text: '你有新消息' });
```

### DistributedRoom — 分布式房间

跨实例的房间管理，支持成员跟踪、房间广播和元数据。

```typescript
import { DistributedRoom, RedisPubSub } from '@nbb-ionet/redis';

const pubSub = new RedisPubSub(client);
const room = new DistributedRoom(client, pubSub);
await room.start();

// 创建房间
await room.createRoom('room1', { name: '游戏房间', maxMembers: 4 });

// 加入/离开
await room.joinRoom('room1', 'user1');
await room.leaveRoom('room1', 'user1');

// 房间广播
await room.broadcastToRoom('room1', { type: 'game:start' });

// 监听房间事件
room.onRoomEvent((roomId, event, userId) => {
  console.log(`${userId} ${event} room ${roomId}`);
});

room.onRoomMessage((roomId, data, senderId) => {
  console.log(`[${roomId}] ${senderId}:`, data);
});
```

### InstanceManager — 实例管理

服务实例注册、心跳、存活检测。

```typescript
import { InstanceManager } from '@nbb-ionet/redis';

const manager = new InstanceManager(client, {
  heartbeatIntervalMs: 10_000,
  heartbeatTimeoutMs: 30_000,
  metadata: { region: 'cn-east' },
});

await manager.register();
const instances = await manager.getInstances();
const alive = await manager.isInstanceAlive('instance-id');
await manager.unregister();
```

### GracefulShutdown — 优雅关闭

协调 Redis 连接和各组件的有序关闭。

```typescript
import { GracefulShutdown } from '@nbb-ionet/redis';

const shutdown = new GracefulShutdown({ timeout: 5000 });
shutdown.addResource(client);
shutdown.addResource(lock);
shutdown.addResource(broadcaster);
await shutdown.shutdown();
```

## IPC 通道常量

```typescript
import { IPC_CHANNELS } from '@nbb-ionet/redis';

IPC_CHANNELS.BROADCAST;     // 全局广播
IPC_CHANNELS.USER_MESSAGE;  // 用户定向消息
IPC_CHANNELS.ROOM_MESSAGE;  // 房间消息
IPC_CHANNELS.ROOM_EVENT;    // 房间事件（join/leave/destroy）
```

## License

AGPL-3.0
