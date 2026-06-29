# Phase 3 · 分布式

**目标**：实现 Logic Server 与 External Server 的分布式部署，支持跨进程/跨机器通信，完成 ionet 核心架构的三服务器模型。

**前置依赖**：Phase 2 已完成（External Server 抽象、Protocol 编解码、Session 管理）

**预计工作量**：5-7 周（按每天 4-6 小时估算）

---

## 一、架构概览

```
┌─────────────────┐         Aeron          ┌─────────────────┐
│ External Server │ ◄──── (UDP/IPC) ────► │  Logic Server   │
│  (HTTP/WS/TCP)  │                        │  (Business Logic)│
└─────────────────┘                        └─────────────────┘
        ▲                                           ▲
        │                                           │
        │           ┌─────────────────┐             │
        └──────────►│ Center Server   │◄────────────┘
                    │  (Discovery)    │
                    └─────────────────┘
```

**核心组件**：
- **External Server**：接收客户端连接，协议编解码，转发请求到 Logic Server
- **Logic Server**：执行业务逻辑（Action），返回响应到 External Server
- **Center Server**：服务注册与发现，路由协调（可选，简单部署可省略）

**通信机制**：
- 使用 Aeron 进行高效 UDP/IPC 通信
- SBE（Simple Binary Encoding）进行消息序列化
- 支持请求-响应、广播、事件总线等模式

---

## 二、任务清单

### 任务 1：Aeron 传输层封装

**目标**：封装 Aeron Java API 为 TypeScript 可用的接口

**子任务**：
- [ ] 研究 Aeron TypeScript/Node.js 绑定
  - [ ] 评估 `aeron-ts`、`node-aeron` 等现有库
  - [ ] 如无可用绑定，考虑 FFI 或 gRPC 桥接方案
- [ ] 实现 AeronClient 封装类
  - [ ] 连接管理（connect/disconnect）
  - [ ] 资源清理（close）
- [ ] 实现 Publication 封装
  - [ ] 消息发布（offer）
  - [ ] 背压处理
- [ ] 实现 Subscription 封装
  - [ ] 消息订阅（poll）
  - [ ] 消息处理回调
- [ ] 编写单元测试
  - [ ] Publication/Subscription 基础测试
  - [ ] 消息收发一致性测试

**验收标准**：
- ✅ 能在同一进程内通过 Aeron IPC 发送/接收消息
- ✅ 能跨进程通过 Aeron UDP 发送/接收消息
- ✅ 消息延迟 < 1ms（本地 IPC）
- ✅ 100% 测试覆盖

---

### 任务 2：SBE 消息编码

**目标**：实现 SBE 消息编解码，定义请求/响应消息格式

**子任务**：
- [ ] 研究 SBE TypeScript 实现
  - [ ] 评估 `sbe-ts`、手动实现等方案
  - [ ] 确定消息 schema 定义方式
- [ ] 定义核心消息类型
  - [ ] `RequestMessage`：cmd, subCmd, data, flowContextId
  - [ ] `ResponseMessage`：data, errorCode, errorMessage
  - [ ] `HeartbeatMessage`：健康检查
  - [ ] `RegisterMessage`：Logic Server 注册
- [ ] 实现 SBE 编解码器
  - [ ] 编码函数（object → Uint8Array）
  - [ ] 解码函数（Uint8Array → object）
- [ ] 实现消息工厂
  - [ ] `createRequestMessage()`
  - [ ] `createResponseMessage()`
  - [ ] `createHeartbeatMessage()`
- [ ] 编写单元测试
  - [ ] 编解码一致性测试
  - [ ] 边界条件测试

**验收标准**：
- ✅ 消息编解码 100% 正确
- ✅ 编码后消息大小 < 原始 JSON 的 50%
- ✅ 编解码延迟 < 0.1ms
- ✅ 100% 测试覆盖

---

### 任务 3：Logic Server 抽象

**目标**：实现 Logic Server 运行时，接收 External Server 的请求并执行业务逻辑

**子任务**：
- [ ] 实现 `LogicServer` 类
  - [ ] 配置管理（id, host, port, aeronChannel）
  - [ ] 生命周期管理（start/stop）
- [ ] 实现 `LogicServerBuilder`
  - [ ] addAction()：注册 ActionController
  - [ ] addInOut()：注册 InOut 插件
  - [ ] build()：构建 LogicServer 实例
- [ ] 实现请求处理
  - [ ] 订阅 External Server 的请求通道
  - [ ] 解码 RequestMessage
  - [ ] 恢复 FlowContext
  - [ ] 调用 BarSkeleton.execute()
  - [ ] 编码 ResponseMessage
  - [ ] 发布响应到 External Server
- [ ] 实现 ActionCommandRegion
  - [ ] 注册 ActionCommand
  - [ ] 路由查找
- [ ] 实现健康检查
  - [ ] 定期发送 HeartbeatMessage
  - [ ] 监控 Aeron 连接状态
- [ ] 编写单元测试
  - [ ] LogicServer 启动/停止测试
  - [ ] 请求处理测试（mock Aeron）
  - [ ] 错误处理测试
- [ ] 编写集成测试
  - [ ] External Server + Logic Server 通信测试
  - [ ] 多 Logic Server 负载均衡测试

**验收标准**：
- ✅ LogicServer 能接收并处理 External Server 的请求
- ✅ 支持多 Logic Server 实例
- ✅ 请求处理延迟 < 5ms（不含业务逻辑）
- ✅ 100% 测试覆盖

---

### 任务 4：External Server 分布式改造

**目标**：改造现有 External Server，支持将请求转发到 Logic Server

**子任务**：
- [ ] 实现 `DistributedExternalServer`
  - [ ] 继承 BaseExternalServer
  - [ ] 订阅 Logic Server 的响应通道
  - [ ] 发布请求到 Logic Server
- [ ] 实现请求转发逻辑
  - [ ] 接收客户端请求（HTTP/WS/TCP）
  - [ ] 编码 RequestMessage
  - [ ] 发布到 Aeron
  - [ ] 等待 Logic Server 响应
  - [ ] 解码 ResponseMessage
  - [ ] 返回给客户端
- [ ] 实现 FlowContext 跨进程传递
  - [ ] 序列化 FlowContext 元数据
  - [ ] 在 Logic Server 端恢复 FlowContext
- [ ] 实现超时处理
  - [ ] 请求超时（默认 5s）
  - [ ] 超时错误响应
- [ ] 实现重试机制
  - [ ] Logic Server 不可用时重试
  - [ ] 指数退避策略
- [ ] 编写单元测试
  - [ ] 请求转发测试（mock Aeron）
  - [ ] 超时测试
  - [ ] 重试测试
- [ ] 编写集成测试
  - [ ] HTTP + Logic Server 端到端测试
  - [ ] WebSocket + Logic Server 端到端测试

**验收标准**：
- ✅ External Server 能将请求转发到 Logic Server
- ✅ 支持超时和重试
- ✅ 端到端延迟 < 10ms（本地部署）
- ✅ 100% 测试覆盖

---

### 任务 5：Center Server（可选）

**目标**：实现服务注册与发现，支持动态路由

**子任务**：
- [ ] 实现 `CenterServer` 类
  - [ ] 配置管理（host, port）
  - [ ] 生命周期管理
- [ ] 实现服务注册
  - [ ] Logic Server 注册接口
  - [ ] External Server 注册接口
  - [ ] 服务心跳监控
- [ ] 实现服务发现
  - [ ] 查询可用 Logic Server
  - [ ] 负载均衡策略（轮询、随机、权重）
- [ ] 实现路由协调
  - [ ] 通知 External Server Logic Server 列表变化
  - [ ] 动态更新路由表
- [ ] 实现管理接口
  - [ ] HTTP API 查询服务状态
  - [ ] 手动下线服务
- [ ] 编写单元测试
  - [ ] 服务注册/发现测试
  - [ ] 负载均衡测试
- [ ] 编写集成测试
  - [ ] External + Logic + Center 三服务器测试
  - [ ] 动态扩缩容测试

**验收标准**：
- ✅ Logic Server 能动态注册/下线
- ✅ External Server 能感知 Logic Server 变化
- ✅ 支持多种负载均衡策略
- ✅ 100% 测试覆盖

---

### 任务 6：EventBus 分布式事件总线

**目标**：实现跨服务的事件发布/订阅机制

**子任务**：
- [ ] 实现 `DistributedEventBus`
  - [ ] 继承 EventBus 接口
  - [ ] 使用 Aeron 广播事件
- [ ] 实现事件发布
  - [ ] 编码事件消息
  - [ ] 发布到广播通道
- [ ] 实现事件订阅
  - [ ] 订阅广播通道
  - [ ] 解码事件消息
  - [ ] 调用订阅者回调
- [ ] 实现事件过滤
  - [ ] 按事件类型过滤
  - [ ] 按来源过滤
- [ ] 编写单元测试
  - [ ] 事件发布/订阅测试
  - [ ] 过滤测试
- [ ] 编写集成测试
  - [ ] 跨服务事件广播测试
  - [ ] 多订阅者测试

**验收标准**：
- ✅ 事件能跨服务广播
- ✅ 支持事件过滤
- ✅ 事件传播延迟 < 5ms
- ✅ 100% 测试覆盖

---

### 任务 7：分布式 Demo

**目标**：演示完整的三服务器分布式部署

**子任务**：
- [ ] 创建 `packages/demo-distributed/`
- [ ] 实现 External Server 进程
  - [ ] 启动 HTTP/WebSocket 服务器
  - [ ] 连接 Logic Server
- [ ] 实现 Logic Server 进程
  - [ ] 注册 HallAction
  - [ ] 连接 External Server
- [ ] 实现 Center Server 进程（可选）
  - [ ] 启动服务发现
- [ ] 编写启动脚本
  - [ ] `start-external.sh`
  - [ ] `start-logic.sh`
  - [ ] `start-center.sh`（可选）
- [ ] 编写测试脚本
  - [ ] HTTP 请求测试
  - [ ] WebSocket 请求测试
  - [ ] 性能测试
- [ ] 编写文档
  - [ ] 部署指南
  - [ ] 配置说明
  - [ ] 故障排查

**验收标准**：
- ✅ 三个进程能独立启动
- ✅ 请求能从客户端 → External → Logic → External → 客户端
- ✅ 支持多 Logic Server 实例
- ✅ 文档清晰完整

---

### 任务 8：文档与回顾

**目标**：完成 Phase 3 文档，总结分布式架构设计

**子任务**：
- [ ] 编写 `phase3-review.md`
  - [ ] 架构设计文档
  - [ ] 关键技术决策
  - [ ] 性能指标
  - [ ] 已知问题与改进方向
- [ ] 更新 `ai-docs/README.md`
  - [ ] 标记 Phase 3 完成
  - [ ] 添加 Phase 3 详细任务清单链接
- [ ] 创建 Phase 4 任务清单
  - [ ] `phase4-extensions.md`
  - [ ] 领域事件（Domain Event）
  - [ ] 房间抽象（Room）
  - [ ] Protobuf 编解码
  - [ ] 代码生成（Codegen）
- [ ] 更新项目 README
  - [ ] 添加分布式部署示例
  - [ ] 更新架构图

**验收标准**：
- ✅ 文档完整、清晰
- ✅ 架构图准确
- ✅ 示例代码可运行

---

## 三、技术栈

**核心依赖**：
- `aeron`：高性能 UDP/IPC 传输（需要 Node.js 绑定或 FFI）
- `sbe`：Simple Binary Encoding 消息序列化
- `uuid`：生成 FlowContext ID

**开发工具**：
- `vitest`：单元测试
- `tsup`：TypeScript 编译
- `tsx`：开发运行时

---

## 四、风险与挑战

### 风险 1：Aeron Node.js 绑定

**问题**：Aeron 官方仅提供 Java/C++ 实现，Node.js 生态中无成熟绑定

**应对方案**：
1. **FFI 方案**：使用 `node-ffi-napi` 调用 Aeron C++ API
2. **gRPC 桥接**：通过 gRPC 与 Java/C++ Aeron 进程通信
3. **替代方案**：使用 NATS、Redis Pub/Sub 等消息队列替代

**建议**：优先尝试 FFI 方案，如性能不达标则考虑 gRPC 桥接

### 风险 2：SBE TypeScript 实现

**问题**：SBE 官方仅提供 Java/C++ 实现

**应对方案**：
1. **手动实现**：根据 SBE schema 手动实现编解码
2. **Protobuf 替代**：使用 Protobuf 替代 SBE（性能略低但生态成熟）
3. **JSON 过渡**：先用 JSON 开发，后续优化为 SBE

**建议**：Phase 3 先用 JSON 过渡，Phase 4 再引入 SBE 或 Protobuf

### 风险 3：FlowContext 跨进程传递

**问题**：FlowContext 包含 AsyncLocalStorage 状态，无法直接序列化

**应对方案**：
1. **元数据传递**：只传递 userId、serverInfo 等元数据
2. **Session 共享**：通过 Redis 共享 Session
3. **重新创建**：在 Logic Server 端重新创建 FlowContext

**建议**：采用元数据传递 + Session 共享方案

---

## 五、性能指标

**目标**：
- 请求延迟（External → Logic → External）：
  - 本地 IPC：< 5ms
  - 本地 UDP：< 10ms
  - 跨机器 UDP：< 50ms
- 吞吐量：
  - 单 Logic Server：> 10,000 req/s
  - 多 Logic Server：线性扩展
- 消息编码：
  - JSON：< 0.5ms
  - SBE：< 0.1ms

---

## 六、里程碑

- **M1**：Aeron 传输层封装完成，能在进程内通信
- **M2**：Logic Server 能接收并处理请求
- **M3**：External Server 能转发请求到 Logic Server
- **M4**：Center Server 支持服务发现
- **M5**：EventBus 支持跨服务广播
- **M6**：分布式 Demo 完成，文档发布

---

## 七、参考资料

- [Aeron Wiki](https://github.com/real-logic/Aeron/wiki)
- [SBE Book](https://mechanical-sympathy.org/sbe/)
- [ionet Java 版文档](https://iohao.github.io/ionet/docs/)
- Phase 1 Review: `packages/core-framework/docs/phase1-review.md`
- Phase 2 Review: `ai-docs/phase2-review.md`
