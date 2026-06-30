# Phase 1 · 核心骨架（Core Skeleton）

> 目标：移植 ionet 的 `core-framework` 模块核心部分，跑通"注册一个 Action → 通过 CmdInfo 调用 → 拿到返回值"的最小闭环。**无网络、无 External、无分布式**，纯内存调用。

---

## 0. 项目脚手架

### 任务清单

- [ ] **M1**: 确定 TS monorepo 工具（pnpm workspaces / turborepo / nx 选一）
- [ ] **M2**: 确定包名前缀（建议 `@nbb-ionet/*`）
- [ ] **M3**: 搭建根目录结构：
  ```
  ionet-ts/
  ├── packages/
  │   ├── common-kit/       ← ionet 的 common-kit
  │   ├── core-framework/   ← ionet 的 core-framework（Phase 1 重点）
  │   └── demo/             ← 最小可运行示例
  ├── ai-docs/              ← 已有
  ├── ionet/                ← Java 原版参考
  ├── pnpm-workspace.yaml
  ├── turbo.json
  ├── tsconfig.base.json
  └── package.json
  ```
- [ ] **M4**: 配置 TypeScript（strict mode、experimental decorators、emitDecoratorMetadata）
- [ ] **M5**: 配置测试框架（Vitest 推荐，兼容 Jest API）
- [ ] **M6**: 配置 lint（ESLint + Prettier，规则在 Phase 1 保持最简）
- [ ] **M7**: 配置构建（tsup / unbuild / tsc 选一；推荐 tsup）
- [ ] **M8**: 安装 `reflect-metadata`、`@types/node`
- [ ] **M9**: 写一个 `hello-world` 包验证 monorepo 跑通（发布/链接）

### 验收标准
- `pnpm install` 成功
- `pnpm build` 成功
- `pnpm test` 跑通 1 个占位测试

---

## 1. common-kit 基础工具

移植 `ionet/common-kit` 中被 core-framework 直接依赖的最小工具集。**不照搬全部 97 个文件**，只搬必要的。

### 任务清单

| # | 任务 | Java 源 | TS 位置 | 备注 |
|---|---|---|---|---|
| 1.1 | 日志常量 | `IonetLogName` | `common-kit/src/log.ts` | 字符串常量 |
| 1.2 | 安全检查工具 | `SafeKit` | `common-kit/src/safe-kit.ts` | size / null 检查 |
| 1.3 | 并发执行器区域 | `ExecutorRegion`、`UserThreadExecutorRegion` | `common-kit/src/concurrent/` | 先做简化版：单线程 + 玩家哈希选择 |
| 1.4 | 全局配置容器 | `CoreGlobalConfig` | `common-kit/src/global-config.ts` | Map 或单例对象 |
| 1.5 | 通用 Kit 类 | `KitAbout` | 拆散到各工具模块 | Java 把一堆静态方法堆在一个类里，TS 用独立函数 |

### 验收标准
- 每个工具有独立单元测试
- 不依赖 ionet 其他模块

---

## 2. 路由注解 + CmdInfo

移植 ionet 的路由系统核心：`@ActionController`、`@ActionMethod`、`CmdInfo`、`CmdKit`、flyweight 缓存。

### 任务清单

| # | 任务 | Java 源 | TS 实现 | 关键差异 |
|---|---|---|---|---|
| 2.1 | `@ActionController(cmd)` | `annotations/ActionController.java` | `core-framework/src/decorators/action-controller.ts` | TS 装饰器 + `Reflect.defineMetadata` |
| 2.2 | `@ActionMethod(subCmd)` | `annotations/ActionMethod.java` | `core-framework/src/decorators/action-method.ts` | 同上 |
| 2.3 | `@ValidatedGroup` | `annotations/ValidatedGroup.java` | **Phase 1 跳过** | JSR380 等价物后续再做 |
| 2.4 | `@Enterprise` | `annotations/Enterprise.java` | **Phase 1 跳过** | 内部注解 |
| 2.5 | `CmdInfo` record | `core/CmdInfo.java` | `core-framework/src/core/cmd-info.ts` | 用 `Object.freeze` + 工厂函数 |
| 2.6 | `CmdKit` | `core/kit/CmdKit.java` | `core-framework/src/core/cmd-kit.ts` | 位运算合并：`(cmd << 16) \| subCmd` |
| 2.7 | `CmdInfoFlyweightFactory` | `core/CmdInfoFlyweightFactory.java` | `core-framework/src/core/cmd-info-flyweight.ts` | TS 用 `Map<number, CmdInfo>` 即可，无需 WeakRef |
| 2.8 | `CmdInfoFlyweightStrategy` | `core/CmdInfoFlyweightStrategy.java` | 合并到 2.7 | 策略可内联 |
| 2.9 | `CmdInfoFlyweightAbout` | `core/CmdInfoFlyweightAbout.java` | 合并到 2.7 | 关联类 |

### 验收标准
```typescript
import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';
import { CmdInfo } from '@nbb-ionet/core-framework';

const HALL_CMD = { cmd: 1, loginVerify: 1, hello: 2 } as const;

@ActionController(HALL_CMD.cmd)
class HallAction {
  @ActionMethod(HALL_CMD.loginVerify)
  login(jwt: string): { id: number; nickname: string } {
    return { id: Math.abs(hashCode(jwt)), nickname: jwt };
  }
}

const cmd = CmdInfo.of(HALL_CMD.cmd, HALL_CMD.loginVerify);
expect(cmd.cmdMerge).toBe((1 << 16) | 1);
expect(CmdInfo.of(cmd.cmdMerge)).toBe(cmd); // flyweight 命中
```

---

## 3. FlowContext 请求上下文

FlowContext 在 Java 中是**多接口组合**（11 个 capability 接口），TS 需要重新设计。

### 设计决策点（需在动手前确认）

**方案 A：单一大类**
```typescript
class FlowContext {
  userId: bigint;
  cmdInfo: CmdInfo;
  request: Request;
  response: Response;
  // ... 所有能力都作为方法
  broadcast(...): void { ... }
  requestLogic(...): Promise<...> { ... }
}
```

**方案 B：接口组合 + mixin**
```typescript
interface FlowContext
  extends FlowAttachment, FlowUserId, FlowBroadcast, FlowLogic, ... {
  // ...
}
```

**推荐：方案 A 起步**，等能力扩展到 8+ 个时再考虑拆分。Phase 1 只需要：
- `getUserId()` / `bindingUserId()`
- `getCmdInfo()` / `getCmdMerge()`
- `getRequest()` / `setResponse()`
- `hasError()` / `getErrorCode()`
- `getNanoTime()`

### 任务清单

| # | 任务 | Java 源 | TS 实现 | 备注 |
|---|---|---|---|---|
| 3.1 | `FlowContext` 接口/类 | `core/flow/FlowContext.java` | `core-framework/src/core/flow/flow-context.ts` | 先做最小集（见上） |
| 3.2 | `DefaultFlowContext` 实现 | `core/flow/DefaultFlowContext.java` | 合并到 3.1 | TS 不需要 interface + impl 拆分 |
| 3.3 | `EmptyFlowContext` | `core/EmptyFlowContext.java` | `core-framework/src/core/flow/empty-flow-context.ts` | 单例空上下文 |
| 3.4 | `FlowContextFactory` | `core/flow/FlowContextFactory.java` | `core-framework/src/core/flow/flow-context-factory.ts` | 工厂函数 |
| 3.5 | `FlowContextKeys` | `core/FlowContextKeys.java` | `core-framework/src/core/flow/flow-context-keys.ts` | 属性键常量 |
| 3.6 | `AsyncLocalStorage` 集成 | 无（Java 没有等价物） | `core-framework/src/core/flow/flow-als.ts` | **TS 新增**：用 Node ALS 让 FlowContext 在调用链中可访问 |

### 验收标准
- FlowContext 可在 Action 方法中作为参数注入
- 通过 ALS 在任意被调用函数内可拿到当前 FlowContext
- 单元测试覆盖 getter/setter/binding

---

## 4. Action 解析与注册

移植 `ActionCommand`、`ActionCommandParser`、`ActionCommandRegion`、`BarSkeletonBuilder`。

### 任务清单

| # | 任务 | Java 源 | TS 实现 | 备注 |
|---|---|---|---|---|
| 4.1 | `ActionMethodParameter` | `core/ActionMethodParameter.java` | `core-framework/src/core/action-method-parameter.ts` | 方法参数元数据 |
| 4.2 | `ActionMethodReturn` | `core/ActionMethodReturn.ts` | `core-framework/src/core/action-method-return.ts` | 返回类型元数据 |
| 4.3 | `ActionParameterPosition` | `core/ActionParameterPosition.java` | 合并到 4.1 | TS 可用 enum 替代 |
| 4.4 | `ActionCommand` | `core/ActionCommand.java` | `core-framework/src/core/action-command.ts` | 用 Function 替代 MethodHandle |
| 4.5 | `ActionCommandRegion` | `core/ActionCommandRegion.java` | `core-framework/src/core/action-command-region.ts` | Map<cmdMerge, ActionCommand> |
| 4.6 | `ActionCommandRegions` | `core/ActionCommandRegions.java` | 合并到 4.5 | 多 region 集合 |
| 4.7 | `ActionFactoryBean` 接口 | `core/ActionFactoryBean.java` | `core-framework/src/core/action-factory-bean.ts` | 工厂接口 |
| 4.8 | `DefaultActionFactoryBean` | `core/DefaultActionFactoryBean.java` | 合并到 4.7 | 默认实现 |
| 4.9 | `ActionCommandParser` 接口 | `core/ActionCommandParser.java` | `core-framework/src/core/action-command-parser.ts` | 解析策略 |
| 4.10 | `DefaultActionCommandParser` | `core/DefaultActionCommandParser.java` | 合并到 4.9 | 默认解析器（基于装饰器元数据） |
| 4.11 | `ActionParserContext` | `core/ActionParserContext.java` | `core-framework/src/core/action-parser-context.ts` | 解析期上下文 |
| 4.12 | `ActionParserListener` | `core/ActionParserListener.java` | `core-framework/src/core/action-parser-listener.ts` | 解析钩子 |
| 4.13 | `ActionParserListeners` | `core/ActionParserListeners.java` | 合并到 4.12 | 多 listener 聚合 |
| 4.14 | `ActionCommandRegionGlobalCheckKit` | `core/kit/ActionCommandRegionGlobalCheckKit.java` | `core-framework/src/core/kit/global-check.ts` | 启动时全局查重 |

### 关键差异说明

**MethodHandle → TS Function**
- Java 用 `MethodHandle` 做低开销反射调用
- TS 直接用 `actionController[methodKey].bind(actionController)` 拿到的 function 即可
- 不需要 invokeWithArguments 这类动态参数传递，TS 原生支持 spread

**类扫描机制**
- Java 用 ClassGraph 或 Spring 的 classpath 扫描
- TS 需要**显式注册**：用户通过 `builder.addAction(HallAction)` 或 `builder.scan([HallAction, OtherAction])`
- 可选进阶：用 babel 插件在编译期收集所有 `@ActionController` 类

### 验收标准
```typescript
const builder = new BarSkeletonBuilder();
builder.addAction(HallAction);
const skeleton = builder.build();

const cmd = CmdInfo.of(1, 1);
const action = skeleton.actionCommandRegion.getActionCommand(cmd);
expect(action).toBeDefined();
expect(action.cmdInfo).toBe(cmd);
```

---

## 5. BarSkeleton 运行时核心

把 ActionCommand 串起来，能真正"调用一个 Action 拿到返回值"。

### 任务清单

| # | 任务 | Java 源 | TS 实现 | 备注 |
|---|---|---|---|---|
| 5.1 | `BarSkeleton` 类 | `core/BarSkeleton.java` | `core-framework/src/core/bar-skeleton.ts` | 中央运行时 |
| 5.2 | `BarSkeletonBuilder` | `core/BarSkeletonBuilder.java` | `core-framework/src/core/bar-skeleton-builder.ts` | 构造器 |
| 5.3 | `BarSkeletonSetting` | `core/BarSkeletonSetting.java` | 合并到 5.2 | 配置项 |
| 5.4 | `BarSkeletonManager` | `core/BarSkeletonManager.java` | `core-framework/src/core/bar-skeleton-manager.ts` | 全局单例 |
| 5.5 | `ActionMethodInvoke` 接口 | `core/flow/ActionMethodInvoke.java` | `core-framework/src/core/flow/action-method-invoke.ts` | 调用策略 |
| 5.6 | `DefaultActionMethodInvoke` | `core/flow/internal/DefaultActionMethodInvoke.java` | 合并到 5.5 | 默认实现 |
| 5.7 | `ActionMethodExceptionProcess` | `core/flow/ActionMethodExceptionProcess.java` | `core-framework/src/core/flow/action-method-exception-process.ts` | 异常处理 |
| 5.8 | `ActionAfter` | `core/flow/ActionAfter.java` | `core-framework/src/core/flow/action-after.ts` | Action 后处理钩子 |
| 5.9 | `FlowExecutor` | `core/FlowExecutor.java` | `core-framework/src/core/flow/flow-executor.ts` | 业务线程调度（Phase 1 简化为同步） |
| 5.10 | `DefaultFlowExecutor` | `core/DefaultFlowExecutor.java` | 合并到 5.9 | 默认实现 |
| 5.11 | `Runner` / `Runners` | `core/runner/Runner.java` 等 | `core-framework/src/core/runner.ts` | 启动钩子 |

### 验收标准
```typescript
const skeleton = new BarSkeletonBuilder()
  .addAction(HallAction)
  .build();

const request = new Request({ cmd: 1, subCmd: 1, data: 'Alice' });
const response = await skeleton.execute(request);
expect(response.data.nickname).toBe('Alice');
```

---

## 6. InOut 插件系统

移植 `ActionMethodInOut` 插件机制，让 FlowContext 的处理链路可被插件拦截。

### 任务清单

| # | 任务 | Java 源 | TS 实现 | 备注 |
|---|---|---|---|---|
| 6.1 | `ActionMethodInOut` 接口 | `core/flow/ActionMethodInOut.java` | `core-framework/src/core/flow/action-method-inout.ts` | in/out 两个钩子 |
| 6.2 | `DebugInOut` | `core/flow/internal/DebugInOut.java` | `core-framework/src/core/flow/internal/debug-inout.ts` | 调试日志 |
| 6.3 | `StatActionInOut` | `core/flow/internal/StatActionInOut.java` | `core-framework/src/core/flow/internal/stat-inout.ts` | 调用统计 |
| 6.4 | InOut 链的执行器 | 内嵌在 DefaultFlowExecutor | 合并到 flow-executor.ts | 串/并行执行 |

### 验收标准
- 注册 DebugInOut 后，每次 Action 调用在控制台打印出入参
- 多个 InOut 按注册顺序执行

---

## 7. 最小 Demo

把 Phase 1 的所有成果串成一个可运行 demo。

### 任务清单

- [ ] **7.1**: 创建 `demos/demo/` 包
- [ ] **7.2**: 实现 `HallAction`（loginVerify + hello 两个方法）
- [ ] **7.3**: 实现 `HallCmd` 常量接口
- [ ] **7.4**: 启动 BarSkeleton 并通过代码调用 Action
- [ ] **7.5**: 打印 DebugInOut 的日志
- [ ] **7.6**: 写 README 演示如何跑起来

### 验收标准
```bash
$ pnpm --filter @nbb-ionet/demo start
[DebugInOut] cmd=1 subCmd=1 data='Alice'
[DebugInOut] cmd=1 subCmd=1 result={id: 12345, nickname: 'Alice'}
[DebugInOut] cmd=1 subCmd=2 result='hello 12345'
```

---

## 8. 文档与回顾

- [ ] **8.1**: 写 `packages/core-framework/README.md`（API 概览）
- [ ] **8.2**: 写 `packages/core-framework/docs/phase1-review.md`（与 ionet 原版差异点）
- [ ] **8.3**: 更新 `ai-docs/README.md` 标记 Phase 1 完成
- [ ] **8.4**: 制定 Phase 2 任务清单（External Server 抽象）
- [ ] **8.5**: 在 ionet-ai 知识库贡献 TS 移植相关的 stable 资产（见 mcp-assets.md 的覆盖缺口）

---

## Phase 1 范围外（明确不做）

| 项 | 原因 | 推迟到 |
|---|---|---|
| 网络（WebSocket/TCP/UDP） | 不在 core 范围 | Phase 2 |
| Protobuf 编解码 | 单独模块 | Phase 4 |
| JSR380 校验 | 需要类验证器 | Phase 2 |
| 文档生成（doc/） | 工具性质 | Phase 5 |
| i18n | 非核心 | Phase 4 |
| Banner / ToyTable | 美化 | Phase 1 末尾可选 |
| 字节码增强（enhance/） | Java 特有 | 评估是否需要 |
| 全链路 Trace | 需要分布式上下文 | Phase 3 |
| EventBus | 需要跨进程 | Phase 3 |
| 协议 wrapper（IntValue 等） | 协议碎片化处理 | Phase 4 |
| Spring/NestJS 集成 | 单独模块 | Phase 4 |

---

## 风险与回退点

| 风险 | 触发条件 | 回退方案 |
|---|---|---|
| TS 装饰器元数据能力不足 | reflect-metadata 拿不到参数类型 | 改用显式 type 标注 + Zod schema |
| 装饰器执行顺序问题 | 类/方法装饰器注册时机与预期不符 | 改用 builder 显式 addAction 而非自动扫描 |
| FlowContext 多继承模拟困难 | capability 接口扩展到 8+ 个时 | 拆成多个独立接口 + 聚合类 |
| AsyncLocalStorage 性能问题 | 高并发下 ALS 成为瓶颈 | 退回显式 ctx 参数传递 |
