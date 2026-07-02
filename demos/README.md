# ionet Demos

ionet TypeScript 版本的示例项目集合，展示从基础到高级的各种功能。

## 项目结构

```text
demos/
├── demo/              # Phase 1 - 基础示例（单进程）
├── demo-cluster/      # Phase 3 - 集群示例（多实例 + Redis IPC）
├── demo-codegen/      # Phase 4 - 代码生成示例
└── demo-nestjs/       # Phase 4 - NestJS 集成示例
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 构建所有包

```bash
pnpm -w run build
```

### 3. 运行 Demo

根据你想测试的功能选择对应的 demo：

| Demo             | 功能         | 依赖  | 运行命令                                                |
|------------------|--------------|-------|---------------------------------------------------------|
| **demo**         | 基础功能     | 无    | `pnpm --filter @nbb-ionet/demo start`                   |
| **demo-cluster** | 分布式集群   | Redis | `pnpm --filter @nbb-ionet/demo-cluster start`           |
| **demo-codegen** | 代码生成     | 无    | `pnpm --filter @nbb-ionet/demo-codegen start`           |
| **demo-nestjs**  | NestJS 集成  | 无    | `pnpm --filter demo-nestjs start`                       |

## Demo 详细说明

### demo - 基础示例

展示 ionet 的核心功能：

- Action 路由定义（`@ActionController` / `@ActionMethod`）
- InOut 插件链（Debug、AccessLog、RateLimit、Session）
- HTTP 和 WebSocket External Server

**适用场景**：初次了解 ionet，验证基础功能。

### demo-cluster - 集群示例

展示分布式集群功能：

- 多实例部署（通过 `INSTANCE_INDEX` 环境变量）
- Redis IPC 跨实例通信
- 分布式 Session 管理
- 分布式房间系统
- 跨实例匹配对战游戏（石头剪刀布）

**前置条件**：需要运行 Redis 服务。

**适用场景**：验证分布式能力，测试跨实例通信。

### demo-codegen - 代码生成示例

展示客户端代码生成：

- 从 Action 定义扫描元数据
- 生成 TypeScript、C#、GDScript、Lua 四种语言
- 生成类型安全的 API 调用代码

**适用场景**：了解如何为游戏客户端生成代码。

### demo-nestjs - NestJS 集成示例

展示 NestJS 框架集成：

- `IonetModule.forRoot()` 配置
- Action 自动注册
- 与 NestJS 控制器共存
- 依赖注入支持

**适用场景**：将 ionet 集成到 NestJS 项目。

## 测试

运行所有单元测试：

```bash
pnpm -r run test
```

运行特定包的测试：

```bash
pnpm --filter @nbb-ionet/core-framework run test
pnpm --filter @nbb-ionet/redis run test
```

## 文档

- [Phase 1 设计文档](../ai-docs/phase1-core-skeleton.md)
- [Phase 2 设计文档](../ai-docs/phase2-external-server.md)
- [Phase 3 设计文档](../ai-docs/phase3-distributed.md)
- [Phase 4 设计文档](../ai-docs/phase4-extensions.md)
- [Phase 4 验收猜想](../ai-docs/phase4-demo-acceptance.md)

## 许可证

AGPL-3.0
