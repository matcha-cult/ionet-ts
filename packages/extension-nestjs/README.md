# @nbb-ionet/extension-nestjs

ionet 与 NestJS 的集成模块 — 自动注册 Action、管理 BarSkeleton 生命周期、启动 HTTP/WS 服务器和 Redis 连接。

## 安装

```bash
pnpm add @nbb-ionet/extension-nestjs
```

需要以下 peerDependencies：

```bash
pnpm add @nestjs/common @nestjs/core reflect-metadata
```

## 快速开始

```typescript
import { Module } from '@nestjs/common';
import { IonetModule } from '@nbb-ionet/extension-nestjs';
import { HallAction } from './actions/hall.action';

@Module({
  imports: [
    IonetModule.forRoot({
      actions: [HallAction],
      httpServer: { port: 8080 },
      wsServer: { port: 9090 },
      redis: { host: '127.0.0.1', port: 6379 },
    }),
  ],
})
export class AppModule {}
```

模块初始化时自动：
1. 构建 `BarSkeleton` 并注册所有 Action（provider 实例化阶段完成）
2. 连接 Redis
3. 启动 HTTP/WS External Server

模块销毁时自动逆序关闭。

## 异步配置

```typescript
IonetModule.forRootAsync({
  useFactory: async (config: ConfigService) => ({
    actions: [HallAction, RoomAction],
    httpServer: { port: config.get('HTTP_PORT') },
    redis: { host: config.get('REDIS_HOST') },
  }),
  inject: [ConfigService],
})
```

## 功能模块

使用 `IonetFeatureModule` 按功能拆分 Action 注册：

```typescript
import { IonetFeatureModule } from '@nbb-ionet/extension-nestjs';

@Module({
  imports: [
    IonetFeatureModule.forFeature({
      actions: [ChatAction],
    }),
  ],
})
export class ChatModule {}
```

`forFeature` 声明的 actions 会在 **feature 模块实例化时**（容器初始化阶段，早于所有 `onModuleInit`）注册进与 `forRoot` 共享的 `BarSkeleton` 路由表——即注册在 HTTP/WS 服务开始监听之前完成。`forRoot` 的 `actions` 与多个 `forFeature` 的 actions 合并进同一张 `cmd → subCmd` 路由表。

> 注意：`forFeature` 必须与 `IonetModule.forRoot()` / `forRootAsync()` 一起使用，否则在容器初始化阶段抛出明确错误。

## actions 字段的生效机制（内部原理）

`actions` 数组从传入到路由可访问，经历「注册 → 启动 → 分发」三个阶段：

### 1. 注册阶段（DI 容器初始化时）

`forRoot` / `forRootAsync` 构建动态模块时：

1. `actions` 以 `IONET_ACTIONS`（Symbol Token）注册为 provider；
2. `IONET_BAR_SKELETON` provider 通过 `useFactory` 注入 `IONET_ACTIONS` 并构建：
   - 对每个 Action 类调用 `BarSkeletonBuilder.addAction(ActionClass)`（此步只记录类引用，不实例化）；
   - `inOuts` → `builder.addInOut()`，`setting` → `builder.setSetting()`；
3. `builder.build()` 执行真正的解析与注册：
   - **实例化**：对每个类直接 `new ActionClass()`（见下文「关键行为约束」）；
   - **元数据解析**：`DefaultActionCommandParser` 通过 `reflect-metadata` 读取类上的 `@ActionController(cmd)` 与方法上的 `@ActionMethod(subCmd)`。缺少 `@ActionController` 的类会直接抛错 `Class X is not decorated with @ActionController`；
   - **参数解析**：读取方法的 `design:paramtypes`（依赖 `emitDecoratorMetadata`），类型为 `FlowContext` 的参数标记为 `FLOW_CONTEXT`，其余标记为 `DATA`；
   - **注册路由表**：每个方法生成一个 `ActionCommand`，注册进 `ActionCommandRegions`——一个 `cmd → subCmd → ActionCommand` 的两级 Map；
   - 产出 `BarSkeleton(actionCommandRegions, setting, inOuts)`。

`BarSkeleton` 另暴露 `addAction(ActionClass, instance?)` 实例方法，支持构建后追加注册——`IonetFeatureModule.forFeature` 即基于它实现（feature 模块构造器注入共享 skeleton 后逐个注册）。

### 2. 启动阶段（onModuleInit）

`IonetModule` 构造函数注入 `IONET_BAR_SKELETON` / `IONET_HTTP_SERVER` / `IONET_WS_SERVER` / `IONET_REDIS_CLIENT` 四个 provider，`onModuleInit` 中按序启动：

1. `redisClient.connect()`
2. `httpServer.start(skeleton)` —— skeleton 引用移交给 External Server 持有
3. `wsServer.start(skeleton)`

`onModuleDestroy` 中按逆序关闭（HTTP → WS → Redis）。

### 3. 运行时分发

以 HTTP 为例，`POST /api/{cmd}/{subCmd}` → `skeleton.execute({ cmd, subCmd, data })`：

1. **路由查找**：`actionCommandRegions.getActionCommand(cmdInfo)` 两级 Map O(1) 查找，未命中返回 `{ errorCode: 404 }`；
2. 生成 `FlowContext`，在 AsyncLocalStorage 上下文中执行；
3. **InOut 插件链**：`fuckInAll`（前置）→ 业务方法 → `fuckOutAll`（后置），异常路径同样走后置链；
4. **方法调用**：按注册时解析的参数标记组参——`FLOW_CONTEXT` 位置注入 ctx，第一个 `DATA` 位置注入请求体，以 `method.bind(actionInstance)(...args)` 调用，`this` 即 `build()` 时创建的实例；
5. 业务异常被统一捕获，转换为 `{ errorCode: 500, errorMessage }`。

### 关键行为约束

- **Action 实例不由 NestJS 容器管理**：`build()` 直接 `new` Action 类。即使给 Action 类加 `@Injectable()`，也无法通过构造函数注入容器内的其他服务（注入值为 `undefined`）。Action 如需访问容器内服务，需自行通过 `moduleRef.get()` 获取后传入或调用；
- **依赖装饰器元数据**：tsconfig 需开启 `experimentalDecorators` 与 `emitDecoratorMetadata`，入口需导入 `reflect-metadata`。否则 `design:paramtypes` 为空，`FlowContext` 参数位置无法识别（会被当作 `DATA`，注入请求体）；
- **`forRoot` 与 `forRootAsync` 注册逻辑一致**：差异仅在于异步版本先通过 `useFactory` 解析出 options 再提取 `actions`；
- **`forFeature` 在模块实例化时注册路由**：feature 模块构造器注入共享 `BarSkeleton` 并调用 `skeleton.addAction()`，发生在服务器监听（所有 `onModuleInit`）之前，注册后对后续请求即时生效。

## 注入 Token

可通过 DI Token 获取 ionet 内部实例：

```typescript
import { Inject } from '@nestjs/common';
import {
  IONET_BAR_SKELETON,
  IONET_HTTP_SERVER,
  IONET_WS_SERVER,
  IONET_REDIS_CLIENT,
} from '@nbb-ionet/extension-nestjs';
import type { BarSkeleton } from '@nbb-ionet/core-framework';
import type { HttpExternalServer, WebSocketExternalServer } from '@nbb-ionet/external-server';
import type { RedisClient } from '@nbb-ionet/redis';

@Injectable()
class MyService {
  constructor(
    @Inject(IONET_BAR_SKELETON) private skeleton: BarSkeleton,
    @Inject(IONET_WS_SERVER) private wsServer: WebSocketExternalServer,
    @Inject(IONET_REDIS_CLIENT) private redis: RedisClient,
  ) {}
}
```

## 配置选项

### IonetModuleOptions

| 字段 | 类型 | 说明 |
|---|---|---|
| `actions` | `Function[]` | `@ActionController` 标注的 Action 类。构建 `BarSkeleton` 时由框架直接 `new` 实例化（不经过 NestJS DI），详见「actions 字段的生效机制」 |
| `inOuts` | `ActionMethodInOut[]` | InOut 插件 |
| `setting` | `BarSkeletonSetting` | BarSkeleton 配置 |
| `httpServer` | `HttpServerOptions \| false` | HTTP 服务器配置，`false` 禁用 |
| `wsServer` | `WsServerOptions \| false` | WebSocket 服务器配置，`false` 禁用 |
| `redis` | `RedisClientOptions \| false` | Redis 配置，`false` 禁用 |

## License

AGPL-3.0
