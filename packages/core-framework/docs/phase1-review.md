# Phase 1 Review: Core Skeleton

> 移植 ionet 的 core-framework 模块核心部分，跑通"注册一个 Action → 通过 CmdInfo 调用 → 拿到返回值"的最小闭环。

## 完成状态

所有 Section 0-7 已完成，Section 8（文档）进行中。

### 验收标准达成

| 标准 | 状态 |
|------|------|
| `pnpm install` 成功 | ✅ |
| `pnpm build` 成功 | ✅ |
| `pnpm test` 跑通（48 个测试） | ✅ |
| Demo 可运行并打印 DebugInOut 日志 | ✅ |

## 模块结构

```
packages/
├── common-kit/         # 通用工具
│   ├── log.ts          # IonetLogName 日志常量
│   ├── safe-kit.ts     # 空值安全工具
│   ├── concurrent/     # 简化版执行器区域
│   └── global-config.ts # 全局配置容器
│
├── core-framework/     # 核心框架（Phase 1 重点）
│   ├── decorators/     # @ActionController, @ActionMethod
│   ├── core/
│   │   ├── cmd-info.ts, cmd-kit.ts, cmd-info-flyweight.ts
│   │   ├── action-command.ts, action-command-region.ts, action-command-parser.ts
│   │   ├── bar-skeleton.ts
│   │   └── flow/       # FlowContext + InOut 插件系统
│   └── ...
│
└── demo/               # 最小可运行示例
```

## 与 ionet Java 原版的关键差异

### 1. 装饰器 vs 注解

**Java 原版**：使用 `@Target(TYPE)` / `@Retention(RUNTIME)` 注解，通过反射在运行时读取。

**TS 版本**：使用 TypeScript 装饰器 + `reflect-metadata`。需要在 tsconfig 中启用 `experimentalDecorators` 和 `emitDecoratorMetadata`。

**差异影响**：
- TS 装饰器在编译时执行，元数据通过 `Reflect.defineMetadata` 存储
- 运行时扫描依赖 `reflect-metadata` polyfill
- tsx（开发时）可能不支持 `design:paramtypes`，需要用构建后的代码测试

### 2. CmdInfo 实现

**Java 原版**：`record CmdInfo(int cmd, int subCmd, int cmdMerge)`，自动不可变、equals/hashCode。

**TS 版本**：`class CmdInfo` + `Object.freeze(this)`，手动实现 `equals()` 和 `toJSON()`。

**差异影响**：
- TS 没有 record 类型，用类+冻结模拟不可变性
- `Object.freeze` 是浅冻结，嵌套对象仍可修改
- flyweight 缓存逻辑相同，用 `Map<number, CmdInfo>` 实现

### 3. FlowContext 设计

**Java 原版**：11 个 capability 接口组合（FlowAttachment, FlowUserId, FlowBroadcast...），`DefaultFlowContext` 实现所有接口。

**TS 版本**：单一大类 `FlowContext`，Phase 1 只实现最小集（getUserId, getCmdInfo, getRequest 等）。

**差异影响**：
- TS 没有多继承，用单类+可选方法更简单
- Phase 2/3 能力扩展时，可能需要拆分为多个 mixin 或独立接口
- `AsyncLocalStorage` 替代 Java 的 `ScopedValue` 实现上下文传递

### 4. Action 调用机制

**Java 原版**：`MethodHandle` 做低开销反射调用，支持 `invokeWithArguments` 动态参数。

**TS 版本**：直接用 `function.bind(controller)(...args)`，原生支持 spread。

**差异影响**：
- TS 没有 MethodHandle 的性能优势，但 V8 的 JIT 优化足够
- 参数传递更简单，不需要处理 Object[] 拆箱

### 5. 类扫描机制

**Java 原版**：ClassGraph / Spring classpath 扫描自动发现 `@ActionController` 类。

**TS 版本**：显式 `builder.addAction(HallAction)` 注册。

**差异影响**：
- TS 没有运行时类扫描，需要用户显式列出所有 Action 类
- 可选进阶：用 babel 插件在编译期收集装饰器类（Phase 2+ 考虑）

### 6. 并发模型

**Java 原版**：`ExecutorRegion` 管理线程池，`UserThreadExecutorRegion` 通过 userId 哈希选择 executor。

**TS 版本**：Node.js 单线程事件循环，`SimpleThreadExecutorRegion` 用 `queueMicrotask` 模拟。

**差异影响**：
- TS 没有真正的多线程并发，不需要处理线程安全问题
- 哈希选择逻辑保留，但实际执行都在主线程
- 未来如果需要 Worker Threads，可以扩展此模块

## 已知限制与待办

### Phase 1 范围内的已知限制

1. **参数类型推断**：`design:paramtypes` 在 tsx 中不工作，导致无法自动识别 `FlowContext` 参数。Phase 1 通过参数位置推断（第一个非 FlowContext 参数视为 data）。

2. **InOut 链执行**：当前 InOut 链是同步的，如果 Action 是异步的，fuckOut 在 Promise resolve 后调用。

3. **FlowContext 能力有限**：只实现了最小集，没有 broadcast、requestLogic 等跨服务调用能力。

### Phase 2 待办

- External Server 抽象（HTTP/WebSocket/TCP 接入层）
- Request/Response 协议层（序列化/反序列化）
- JSR380 等价物（Zod schema 校验）
- Action 参数自动绑定（基于 schema）

## 测试覆盖

```
common-kit:       26 tests (log, safe-kit, concurrent, global-config)
core-framework:   48 tests (decorators, cmd-info, flow-context, action-command, bar-skeleton, inout)
─────────────────────────────
Total:            74 tests, all passing
```

## 构建产物

- `@ionet/common-kit`: 4.07 KB (ESM) + 3.47 KB (DTS)
- `@ionet/core-framework`: 16.33 KB (ESM) + 8.04 KB (DTS)

---

**Phase 1 状态：✅ 完成**
