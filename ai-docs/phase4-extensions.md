# Phase 4 · 扩展能力

**目标**：实现框架扩展层 — Domain Event、Protobuf 编解码、代码生成、NestJS 集成。

**前置依赖**：Phase 3 已完成（Redis IPC 分布式通信）

**核心技术**：
- **protobufjs**：Protocol Buffers 编解码
- **ts-morph / TypeScript Compiler API**：代码生成
- **@nestjs/common**：NestJS 适配

**设计原则**：
- 所有扩展均为可选依赖，不使用时不增加包体积
- 通过 SPI 接口支持多种实现
- 生成的客户端代码可直接用于游戏客户端

---

## 任务清单

### 任务 1：Protobuf 编解码

**目标**：实现 Protocol Buffers 的 ProtocolCodec 实现

**子任务**：
- [ ] 创建 `@nbb-ionet/extension-jprotobuf` 包
  - [ ] package.json, tsconfig.json, tsup.config.ts
  - [ ] 依赖：protobufjs, @nbb-ionet/core-framework
- [ ] 实现 `@ProtobufClass` 装饰器
  - [ ] 标记类为 Protobuf 可序列化
  - [ ] 自动扫描字段类型
  - [ ] 生成 .proto schema
- [ ] 实现 ProtobufProtocolCodec
  - [ ] 实现 ProtocolCodec 接口
  - [ ] encode：对象 → Uint8Array
  - [ ] decode：Uint8Array → 对象
  - [ ] contentType: 'application/x-protobuf'
- [ ] 实现字段类型映射
  - [ ] string → string
  - [ ] number → int32 / double（根据值范围）
  - [ ] bigint → int64
  - [ ] boolean → bool
  - [ ] 嵌套对象 → message
  - [ ] 数组 → repeated
- [ ] 编写单元测试
  - [ ] 基础类型编解码
  - [ ] 嵌套消息编解码
  - [ ] 数组字段编解码
  - [ ] 与 JSON 编解码对比验证

**验收标准**：
- 编解码结果与 protobufjs 原生 API 一致
- 支持嵌套消息和数组
- 性能优于 JSON（体积更小、速度更快）
- 100% 测试覆盖

---

### 任务 2：Domain Event（领域事件）

**目标**：实现高性能的领域事件系统，支持按房间/用户隔离的并发处理

**子任务**：
- [ ] 创建 `@nbb-ionet/extension-domain-event` 包
  - [ ] package.json, tsconfig.json, tsup.config.ts
  - [ ] 依赖：@nbb-ionet/core-framework
- [ ] 实现 DomainEventBus
  - [ ] publish(event)：发布事件
  - [ ] subscribe(eventType, handler)：订阅事件
  - [ ] 支持异步处理
- [ ] 实现并发隔离
  - [ ] 按 roomId 分区：同一房间的事件串行处理
  - [ ] 按 userId 分区：同一用户的事件串行处理
  - [ ] 不同分区并行执行
- [ ] 实现 RingBuffer（可选）
  - [ ] 高性能无锁队列
  - [ ] 替代 Node.js 的事件循环
- [ ] 实现事件类型定义
  - [ ] `@DomainEvent(type)` 装饰器
  - [ ] 事件基类
  - [ ] 事件元数据（timestamp, source）
- [ ] 编写单元测试
  - [ ] 事件发布/订阅
  - [ ] 并发隔离验证
  - [ ] 事件顺序保证
  - [ ] 错误处理

**验收标准**：
- 同一房间/用户的事件串行处理
- 不同房间/用户的事件并行执行
- 事件处理不阻塞主线程
- 吞吐量 > 100,000 events/s
- 100% 测试覆盖

---

### 任务 3：代码生成（Codegen）

**目标**：从 Action 定义生成多语言客户端代码

**子任务**：
- [ ] 创建 `@nbb-ionet/extension-codegen` 包
  - [ ] package.json, tsconfig.json, tsup.config.ts
  - [ ] 依赖：ts-morph, @nbb-ionet/core-framework
- [ ] 实现 Action 扫描器
  - [ ] 读取 @ActionController 和 @ActionMethod 元数据
  - [ ] 提取参数类型和返回类型
  - [ ] 生成 ActionCommand 列表
- [ ] 实现 TypeScript 代码生成
  - [ ] 生成 cmd/subCmd 常量
  - [ ] 生成请求/响应类型
  - [ ] 生成 API 调用函数
  - [ ] 支持 HTTP 和 WebSocket 客户端
- [ ] 实现 C# 代码生成
  - [ ] 生成 .cs 文件
  - [ ] 支持 Unity 项目
- [ ] 实现 GDScript 代码生成
  - [ ] 生成 .gd 文件
  - [ ] 支持 Godot 项目
- [ ] 实现 Lua 代码生成
  - [ ] 生成 .lua 文件
  - [ ] 支持 OpenResty 等
- [ ] 编写单元测试
  - [ ] Action 扫描测试
  - [ ] TypeScript 代码生成测试
  - [ ] C# 代码生成测试
  - [ ] 生成代码可编译验证

**验收标准**：
- 能从 Action 定义生成可运行的客户端代码
- 支持 TypeScript、C#、GDScript、Lua 四种语言
- 生成的代码类型安全
- 包含完整的 cmd/subCmd 常量和类型定义
- 100% 测试覆盖

---

### 任务 4：NestJS 集成

**目标**：提供 NestJS Module 和 Provider，让 ionet 能在 NestJS 项目中使用

**子任务**：
- [ ] 创建 `@nbb-ionet/extension-nestjs` 包
  - [ ] package.json, tsconfig.json, tsup.config.ts
  - [ ] 依赖：@nestjs/common, @nbb-ionet/core-framework
- [ ] 实现 IonetModule
  - [ ] forRoot(options)：全局配置
  - [ ] forFeature(actions)：注册 Action
  - [ ] 导出 BarSkeleton provider
- [ ] 实现 Action 自动扫描
  - [ ] 使用 @Injectable() 标记 Action 类
  - [ ] 自动注册到 BarSkeleton
  - [ ] 支持依赖注入
- [ ] 实现 External Server 集成
  - [ ] HttpExternalServer 作为 NestJS provider
  - [ ] WebSocketExternalServer 作为 NestJS provider
  - [ ] 生命周期管理（onModuleInit, onModuleDestroy）
- [ ] 实现 Redis 集成
  - [ ] RedisClient 作为 NestJS provider
  - [ ] 分布式 Session 自动配置
- [ ] 编写示例项目
  - [ ] NestJS + ionet 完整示例
  - [ ] 展示依赖注入
  - [ ] 展示多模块组织
- [ ] 编写单元测试
  - [ ] Module 配置测试
  - [ ] Action 注册测试
  - [ ] 生命周期测试

**验收标准**：
- 能在 NestJS 项目中通过 Module 引入 ionet
- 支持依赖注入
- 生命周期与 NestJS 一致
- 示例项目可运行
- 100% 测试覆盖

---

### 任务 5：房间扩展（Room Extension）

**目标**：增强房间系统，支持更丰富的房间功能

**子任务**：
- [ ] 在 `@nbb-ionet/redis` 中扩展 DistributedRoom
  - [ ] 房间属性动态修改
  - [ ] 房间成员角色（owner/admin/member）
  - [ ] 房间消息历史
  - [ ] 房间搜索与列表
- [ ] 实现房间事件钩子
  - [ ] onRoomCreate
  - [ ] onRoomDestroy
  - [ ] onUserJoin
  - [ ] onUserLeave
  - [ ] onRoomMessage
- [ ] 实现房间范围广播
  - [ ] broadcastToRoom(roomId, data, excludeUserId)
  - [ ] 支持消息类型过滤
- [ ] 编写单元测试
  - [ ] 房间属性修改测试
  - [ ] 角色权限测试
  - [ ] 事件钩子测试

**验收标准**：
- 支持房间角色和权限
- 事件钩子可被业务代码监听
- 房间范围广播高效
- 100% 测试覆盖

---

### 任务 6：集成 Demo 与文档

**目标**：完善 Phase 4 的 Demo 和文档

**子任务**：
- [ ] 更新 demo-cluster
  - [ ] 使用 Protobuf 编解码
  - [ ] 展示 Domain Event 使用
  - [ ] 展示房间扩展功能
- [ ] 创建 NestJS 示例
  - [ ] `packages/demo-nestjs/`
  - [ ] 完整 NestJS 项目
  - [ ] 展示 ionet 集成
- [ ] 编写 Codegen 示例
  - [ ] 生成 TypeScript 客户端
  - [ ] 生成 C# 客户端
  - [ ] 验证生成代码可运行
- [ ] 编写文档
  - [ ] Protobuf 使用指南
  - [ ] Domain Event 使用指南
  - [ ] Codegen 使用指南
  - [ ] NestJS 集成指南
- [ ] 编写 `phase4-review.md`
  - [ ] 架构设计文档
  - [ ] 性能指标
  - [ ] 已知问题与改进方向

**验收标准**：
- 所有扩展功能有配套 Demo
- 文档完整、清晰
- 示例代码可运行
- Phase 4 交付

---

## 里程碑

- **M1**：Protobuf 编解码完成，支持基础类型和嵌套消息
- **M2**：Domain Event 完成，支持并发隔离
- **M3**：Codegen 完成，支持 TypeScript/C#/GDScript/Lua
- **M4**：NestJS 集成完成，示例项目可运行
- **M5**：房间扩展完成，支持角色和事件钩子
- **M6**：文档和 Demo 完成，Phase 4 交付

---

## 技术栈

**核心依赖**：
- `protobufjs`：Protocol Buffers 编解码
- `ts-morph`：TypeScript AST 操作（Codegen）
- `@nestjs/common`：NestJS 适配

**开发工具**：
- `vitest`：单元测试
- `tsup`：TypeScript 编译
- `tsx`：开发运行时

---

## 风险与挑战

### 风险 1：Protobuf 与 TypeScript 类型映射

**问题**：TypeScript 的类型系统比 Protobuf 更丰富，部分类型无法直接映射

**应对方案**：
1. 约定支持的类型子集
2. 使用自定义序列化器处理特殊类型
3. 提供类型转换工具函数

### 风险 2：Codegen 复杂度

**问题**：生成多语言代码需要处理不同语言的语法差异

**应对方案**：
1. 使用 ts-morph 处理 TypeScript
2. 使用模板引擎处理其他语言
3. 先实现 TypeScript，再扩展其他语言

### 风险 3：NestJS 版本兼容

**问题**：NestJS 版本更新频繁，可能破坏兼容性

**应对方案**：
1. 使用 peerDependencies 声明兼容版本
2. 在多个 NestJS 版本上测试
3. 保持适配层简洁，减少依赖

---

## 参考资料

- [protobufjs 文档](https://protobufjs.github.io/protobuf.js/)
- [ts-morph 文档](https://ts-morph.com/)
- [NestJS 文档](https://docs.nestjs.com/)
- Phase 3 Review: `ai-docs/phase3-review.md`
