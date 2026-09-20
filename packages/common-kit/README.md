# @nbb-ionet/common-kit

ionet 公共工具库，提供日志主题常量、空安全工具函数、全局配置及并发执行器。

## 安装

```bash
pnpm add @nbb-ionet/common-kit
```

## 模块

### IonetLogName — 日志主题常量

使用 `@Slf4j(topic = IonetLogName.CommonStdout)` 风格的日志主题，替代默认的类名。

```typescript
import { IonetLogName } from '@nbb-ionet/common-kit';

IonetLogName.CommonStdout;   // 'CommonStdout'
IonetLogName.ExternalTopic;  // 'ExternalTopic'
IonetLogName.MsgTransferTopic; // 'MsgTransferTopic'
IonetLogName.ConnectionTopic;  // 'ConnectionTopic'
```

### SafeKit — 空安全工具

带默认值的空安全取值函数，避免 null/undefined 导致的运行时错误。

```typescript
import { SafeKit } from '@nbb-ionet/common-kit';

SafeKit.getInt(null);           // 0
SafeKit.getInt(null, 42);       // 42
SafeKit.getInt('123', 0);       // 123
SafeKit.getLong(null, 0n);      // 0n
SafeKit.getBoolean(undefined, true); // true
SafeKit.getString(null, 'fallback'); // 'fallback'
SafeKit.size(null);             // 0
SafeKit.size([1, 2, 3]);        // 3
```

### CoreGlobalConfig — 全局配置

```typescript
import { CoreGlobalConfig, setNetId, getFutureTimeoutMillis } from '@nbb-ionet/common-kit';

setNetId(1);
getFutureTimeoutMillis(); // 默认超时
```

### 并发执行器

按 userId 分区的并发执行器，保证同一用户的任务串行执行。

```typescript
import { DefaultExecutorRegion, executorRegionKit } from '@nbb-ionet/common-kit';

const region = new DefaultExecutorRegion(4);

const executor = region.getUserThreadExecutor(userId);
executor.execute(() => {
  // 同一 userId 的任务会串行执行
});

// 或使用全局单例
executorRegionKit.getUserThreadExecutor(1n).execute(async () => {
  // ...
});
```

| 类 | 说明 |
|---|---|
| `TaskExecutor` | 任务执行器接口 |
| `SimpleTaskExecutor` | 简单实现 |
| `ThreadExecutorRegion` | 线程执行器分区接口 |
| `SimpleThreadExecutorRegion` | 基于取模分区的实现 |
| `ExecutorRegion` | 用户/通用双分区执行器 |
| `DefaultExecutorRegion` | 默认实现 |

## License

AGPL-3.0
