# @ionet/core-framework

ionet TypeScript 移植的核心框架模块，提供 Action 路由、FlowContext、BarSkeleton 运行时。

## 安装

```bash
pnpm add @ionet/core-framework reflect-metadata
```

## 快速开始

```typescript
import 'reflect-metadata';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
  DebugInOut,
} from '@ionet/core-framework';

const CMD = { cmd: 1, hello: 1 } as const;

@ActionController(CMD.cmd)
class HelloAction {
  @ActionMethod(CMD.hello)
  hello(name: string): string {
    return `Hello, ${name}!`;
  }
}

const skeleton = new BarSkeletonBuilder()
  .addAction(HelloAction)
  .addInOut(new DebugInOut())
  .build();

const response = await skeleton.execute({
  cmd: CMD.cmd,
  subCmd: CMD.hello,
  data: 'World',
});
console.log(response.data); // "Hello, World!"
```

## API 概览

### 装饰器

- `@ActionController(cmd)` - 标记类为 Action 控制器
- `@ActionMethod(subCmd)` - 标记方法为路由处理方法

### 路由

- `CmdInfo` - 命令路由信息（cmd + subCmd + cmdMerge）
- `CmdInfoFlyweightFactory` - CmdInfo 享元工厂
- `cmdMerge(cmd, subCmd)` - 合并 cmd 和 subCmd 为单个整数

### 请求上下文

- `FlowContext` - 请求上下文，携带 userId、cmdInfo、request/response 等
- `getCurrentFlowContext()` - 通过 AsyncLocalStorage 获取当前上下文
- `runWithFlowContext(ctx, fn)` - 在指定上下文中执行函数
- `createFlowContext(options)` - 创建 FlowContext 实例

### Action 解析

- `ActionCommand` - 注册的路由命令对象
- `ActionCommandRegion` - 单个 cmd 下的所有 ActionCommand
- `ActionCommandRegions` - 所有 cmd 的 ActionCommandRegion 集合
- `DefaultActionCommandParser` - 基于装饰器元数据的解析器

### 运行时

- `BarSkeleton` - 中央运行时，处理请求并调用 Action
- `BarSkeletonBuilder` - BarSkeleton 构造器

### 插件

- `ActionMethodInOut` - InOut 插件接口（fuckIn/fuckOut）
- `InOutChain` - InOut 插件链
- `DebugInOut` - 调试日志插件
- `StatActionInOut` - 调用统计插件

## 与 Java 原版的差异

| Java 原版 | TS 版本 | 说明 |
|-----------|---------|------|
| `MethodHandle` | `Function` | TS 直接支持函数引用和 spread 调用 |
| `record CmdInfo` | `class CmdInfo + Object.freeze` | TS 没有 record，用类+冻结模拟 |
| Classpath 扫描 | 显式 `addAction()` | TS 没有运行时类扫描，需要显式注册 |
| 11 个 capability 接口 | 单一大类 `FlowContext` | Phase 1 简化，能力扩展后再拆分 |
| `ScopedValue<FlowContext>` | `AsyncLocalStorage<FlowContext>` | TS 用 ALS 实现异步上下文传递 |
| `Integer` cmdMerge | `number` cmdMerge | JS number 是双精度浮点，足够处理 32 位整数 |

详细差异说明见 `docs/phase1-review.md`。

## License

AGPL-3.0
