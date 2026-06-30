# @nbb-ionet/demo

Phase 1 最小可运行示例，演示 ionet core-framework 的基本用法。

## 运行

```bash
pnpm --filter @nbb-ionet/demo start
```

## 功能展示

1. **Action 注册**：使用 `@ActionController` 和 `@ActionMethod` 装饰器声明路由
2. **InOut 插件**：注册 `DebugInOut` 打印调用日志，`StatActionInOut` 统计调用信息
3. **BarSkeleton 运行时**：通过 `BarSkeletonBuilder` 构建运行时，调用 `execute()` 处理请求

## 结构

```
src/
└── main.ts     # 入口，定义 HallAction 并运行 demo
```
