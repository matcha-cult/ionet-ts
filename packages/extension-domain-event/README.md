# @nbb-ionet/extension-domain-event

高性能领域事件系统，支持分区并发隔离与分区内顺序处理。

## 安装

```bash
pnpm add @nbb-ionet/extension-domain-event
```

## 快速开始

```typescript
import 'reflect-metadata';
import { DomainEvent, DomainEventBase, domainEventBus } from '@nbb-ionet/extension-domain-event';

@DomainEvent({ type: 'user.registered' })
class UserRegisteredEvent extends DomainEventBase {
  constructor(readonly userId: string, readonly email: string) {
    super();
  }
}

// 订阅事件
const unsubscribe = domainEventBus.subscribe(UserRegisteredEvent, (event) => {
  console.log(`User ${event.userId} registered with ${event.email}`);
});

// 发布事件
await domainEventBus.publish(new UserRegisteredEvent('u1', 'a@b.com'));

// 取消订阅
unsubscribe();
```

## 分区顺序处理

按分区键（如 userId、roomId）隔离并发，同一分区内事件严格顺序处理。

```typescript
// 按 userId 分区 — 同一用户的事件顺序处理，不同用户并行处理
domainEventBus.subscribeWithPartition(
  UserRegisteredEvent,
  async (event) => {
    // 同一 userId 的事件会按顺序执行
    await processUser(event);
  },
  (event) => event.userId, // 分区键提取器
);
```

## API

### 装饰器

- `@DomainEvent({ type })` — 标记领域事件类，`type` 为事件类型标识
- `DomainEventBase` — 事件基类，自动携带 `metadata`（timestamp、source）

### DomainEventBus

| 方法 | 说明 |
|---|---|
| `publish(event, partitionKey?)` | 发布事件，可选指定分区键 |
| `subscribe(eventType, handler, options?)` | 订阅事件，返回取消订阅函数 |
| `subscribeWithPartition(eventType, handler, partitionExtractor)` | 带分区的事件订阅 |
| `clear()` | 清除所有订阅和队列 |

全局单例 `domainEventBus` 可直接使用，也可自行 `new DomainEventBus()`。

## License

AGPL-3.0
