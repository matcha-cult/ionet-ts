# Phase 3 · Redis IPC 分布式通信

**目标**：实现基于 Redis 的进程间通信层，支持多实例部署下的会话共享、消息广播、状态同步。

**前置依赖**：Phase 2 已完成（External Server 抽象、HTTP/WebSocket 支持、Session 管理）

**部署模式**：多实例（任意进程管理器：PM2、Docker、systemd、原生 Node.js 等）

**核心技术**：
- **Redis**：IPC 通信 + 缓存 + 会话存储（唯一外部依赖）
- **ioredis**：Redis 客户端（支持 pub/sub、cluster、pipeline）

**设计原则**：
- ✅ 进程管理器无关：不依赖 PM2 等特定工具的特性
- ✅ 水平扩展：实例数量可动态调整
- ✅ 优雅降级：Redis 不可用时可降级为单实例模式

---

## 一、架构概览

```
┌─────────────────────────────────────────────────────────┐
│              Multi-Instance Deployment                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Instance 0  │  │ Instance 1  │  │ Instance 2  │    │
│  │ HTTP :8080  │  │ HTTP :8081  │  │ HTTP :8082  │    │
│  │ WS   :9080  │  │ WS   :9081  │  │ WS   :9082  │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │            │
│         └────────────────┼────────────────┘            │
│                          │                            │
│                    ┌─────┴─────┐                       │
│                    │   Redis   │                       │
│                    │  Pub/Sub  │                       │
│                    │   Cache   │                       │
│                    │  Session  │                       │
│                    └───────────┘                       │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │
                    ┌─────┴─────┐
                    │  Clients  │
                    └───────────┘

部署方式示例（任选其一）：
- PM2: pm2 start app.js -i 3
- Docker: docker-compose up --scale app=3
- systemd: 配置多个 service 实例
- Kubernetes: Deployment with replicas=3
- 原生: node app.js & node app.js & node app.js &
```

**核心能力**：
1. **会话共享**：用户登录任意实例，会话数据通过 Redis 共享
2. **消息广播**：向所有在线用户广播时，通过 Redis pub/sub 跨实例传递
3. **房间同步**：房间状态变更通过 Redis 同步到所有实例
4. **分布式锁**：关键操作（如道具交易）通过 Redis 分布式锁保证一致性

---

## 二、任务清单

### 任务 1：Redis 基础设施

**目标**：搭建 Redis 连接管理和基础工具类

**子任务**：
- [x] 创建 `@nbb-ionet/redis` 包
  - [x] package.json, tsconfig.json, tsup.config.ts
  - [x] 依赖：ioredis, @nbb-ionet/common-kit
- [x] 实现 RedisClient 封装类
  - [x] 连接管理（connect/disconnect/reconnect）
  - [x] 配置选项（host, port, password, db）
  - [x] 健康检查（ping）
- [x] 实现 Redis 连接池
  - [x] 支持多 DB 隔离
  - [x] 连接复用
- [x] 编写单元测试
  - [x] 连接/断开测试
  - [x] 基础命令测试（get/set/del）
  - [x] 重连机制测试

**验收标准**：
- ✅ Redis 连接稳定，支持自动重连
- ✅ 基础命令延迟 < 1ms
- ✅ 100% 测试覆盖

---

### 任务 2：Redis Pub/Sub 消息系统

**目标**：实现跨进程的消息发布/订阅机制

**子任务**：
- [x] 实现 RedisPubSub 类
  - [x] publish(channel, message)
  - [x] subscribe(channel, callback)
  - [x] unsubscribe(channel)
  - [x] 消息序列化（JSON）
- [x] 实现消息类型定义
  - [x] `BroadcastMessage`：全局广播
  - [x] `RoomMessage`：房间消息
  - [x] `UserMessage`：用户私聊
  - [x] `SystemMessage`：系统通知
- [x] 实现消息路由器
  - [x] 根据消息类型分发到对应处理器
  - [x] 支持通配符订阅（如 `room:*`）
- [x] 编写单元测试
  - [x] 发布/订阅基础测试
  - [x] 多订阅者测试
  - [x] 消息序列化测试

**验收标准**：
- ✅ 消息能在多个实例间正确传递
- ✅ 消息延迟 < 5ms
- ✅ 支持通配符订阅
- ✅ 100% 测试覆盖

---

### 任务 3：分布式 Session 管理

**目标**：将会话存储从内存迁移到 Redis，支持跨实例会话共享

**子任务**：
- [x] 实现 RedisSessionStore
  - [x] 实现 SessionStore 接口
  - [x] get(sessionId)：从 Redis 读取
  - [x] save(sessionId, session)：写入 Redis
  - [x] remove(sessionId)：删除 Redis
  - [x] TTL 支持（默认 30 分钟）
- [x] 实现会话序列化
  - [x] bigint → string（Redis 不支持 bigint）
  - [x] Map → object
  - [x] 反序列化恢复
- [x] 更新 DefaultSessionManager
  - [x] 支持注入 RedisSessionStore
  - [x] 会话缓存策略（本地缓存 + Redis）
- [x] 编写单元测试
  - [x] 会话读写测试
  - [x] TTL 过期测试
  - [x] 序列化/反序列化测试

**验收标准**：
- ✅ 用户登录实例 A，请求实例 B 能识别会话
- ✅ 会话数据在 Redis 中可查看
- ✅ 支持会话过期自动清理
- ✅ 100% 测试覆盖

---

### 任务 4：分布式广播系统

**目标**：实现跨实例的用户广播能力

**子任务**：
- [x] 实现 DistributedBroadcaster
  - [x] broadcastToAll(message)：广播给所有在线用户
  - [x] broadcastToUser(userId, message)：广播给指定用户（可能在其他实例）
  - [x] broadcastToRoom(roomId, message)：广播给房间内所有用户
- [x] 实现用户-实例映射
  - [x] Redis Hash：`user:instance` 映射
  - [x] 用户连接时注册到 Redis
  - [x] 用户断开时从 Redis 移除
- [x] 实现广播消息路由
  - [x] 本地用户：直接推送
  - [x] 远程用户：通过 Redis pub/sub 转发
- [x] 编写单元测试
  - [x] 全局广播测试
  - [x] 用户定向广播测试
  - [x] 房间广播测试

**验收标准**：
- ✅ 广播消息能到达所有实例的用户
- ✅ 用户迁移实例后仍能收到消息
- ✅ 广播延迟 < 10ms
- ✅ 100% 测试覆盖

---

### 任务 5：分布式房间系统

**目标**：实现跨实例的房间管理和状态同步

**子任务**：
- [x] 实现 DistributedRoom
  - [x] 房间元数据存储到 Redis
  - [x] 房间成员列表存储到 Redis Set
  - [x] 房间状态变更通过 pub/sub 同步
- [x] 实现房间操作
  - [x] createRoom(roomId, options)
  - [x] joinRoom(roomId, userId)
  - [x] leaveRoom(roomId, userId)
  - [x] destroyRoom(roomId)
- [x] 实现房间消息路由
  - [x] 房间创建/销毁：广播到所有实例
  - [x] 用户加入/离开：同步成员列表
  - [x] 房间内消息：通过 pub/sub 传递
- [x] 编写单元测试
  - [x] 房间创建/销毁测试
  - [x] 跨实例加入/离开测试
  - [x] 房间消息同步测试

**验收标准**：
- ✅ 用户在不同实例能加入同一房间
- ✅ 房间状态在所有实例保持一致
- ✅ 房间消息实时同步
- ✅ 100% 测试覆盖

---

### 任务 6：分布式锁

**目标**：实现基于 Redis 的分布式锁，保证关键操作的原子性

**子任务**：
- [x] 实现 RedisDistributedLock
  - [x] acquire(key, ttl)：获取锁
  - [x] release(key)：释放锁
  - [x] 自动续期（watchdog 机制）
- [x] 实现锁装饰器
  - [x] `@Lock(key)` 装饰器
  - [x] 自动获取/释放锁
  - [x] 超时处理
- [x] 实现常见锁场景
  - [x] 道具交易锁
  - [x] 金币转账锁
  - [x] 房间操作锁
- [x] 编写单元测试
  - [x] 锁获取/释放测试
  - [x] 竞争条件测试
  - [x] 超时处理测试

**验收标准**：
- ✅ 同一时刻只有一个实例能持有锁
- ✅ 锁超时后自动释放
- ✅ 支持锁续期
- ✅ 100% 测试覆盖

---

### 任务 7：多实例部署配置

**目标**：提供多实例部署的配置示例和最佳实践

**子任务**：
- [x] 实现实例标识
  - [x] 从环境变量读取实例 ID（`INSTANCE_ID` 或自动生成）
  - [x] 实例注册到 Redis
- [x] 实现优雅关闭
  - [x] 接收 SIGINT/SIGTERM 信号
  - [x] 清理 Redis 中的实例数据
  - [x] 等待请求处理完成
- [x] 提供部署配置示例
  - [x] PM2: `ecosystem.config.js`
  - [x] Docker: `docker-compose.yml`
  - [x] systemd: service 文件
  - [x] Kubernetes: deployment.yaml
- [x] 编写部署文档
  - [x] 各部署方式的启动命令
  - [x] 监控命令
  - [x] 日志查看
- [x] 编写集成测试
  - [x] 多实例启动测试
  - [x] 负载均衡测试
  - [x] 故障转移测试

**验收标准**：
- ✅ 多实例能同时运行
- ✅ 请求能均匀分配到各实例
- ✅ 实例故障后自动重启
- ✅ 提供至少 3 种部署方式的配置示例
- ✅ 文档清晰完整

---

### 任务 8：集成 Demo

**目标**：演示完整的多实例 + Redis IPC 场景

**子任务**：
- [x] 创建 `demos/demo-cluster/`
- [x] 实现多实例场景
  - [x] 用户登录（会话共享）
  - [x] 房间聊天（跨实例）
  - [x] 全局广播
  - [x] 道具交易（分布式锁）
- [x] 编写测试脚本
  - [x] 模拟 100 用户登录
  - [x] 跨实例消息测试
  - [x] 并发交易测试
- [x] 编写监控脚本
  - [x] 实时显示各实例连接数
  - [x] Redis 数据查看
  - [x] 消息流转追踪
- [x] 编写文档
  - [x] 部署指南
  - [x] 场景说明
  - [x] 性能指标

**验收标准**：
- ✅ 所有场景在多实例下正常运行
- ✅ 会话、房间、广播跨实例工作
- ✅ 分布式锁保证数据一致性
- ✅ 文档清晰，可复现

---

### 任务 9：文档与回顾

**目标**：完成 Phase 3 文档，总结分布式架构设计

**子任务**：
- [x] 编写 `phase3-review.md`
  - [x] 架构设计文档
  - [x] Redis IPC 机制
  - [x] 性能指标
  - [x] 已知问题与改进方向
- [x] 更新 `ai-docs/README.md`
  - [x] 标记 Phase 3 完成
  - [x] 添加 Phase 3 详细任务清单链接
- [x] 创建 Phase 4 任务清单
  - [x] `phase4-extensions.md`
  - [x] Domain Event（领域事件）
  - [x] Protobuf 编解码
  - [x] 代码生成（Codegen）
  - [x] Spring/NestJS 集成
- [x] 更新项目 README
  - [x] 添加集群部署示例
  - [x] 更新架构图

**验收标准**：
- ✅ 文档完整、清晰
- ✅ 架构图准确
- ✅ 示例代码可运行

---

## 三、技术栈

**核心依赖**：
- `ioredis`：Redis 客户端（支持 pub/sub、cluster、pipeline）
- `@nbb-ionet/redis`：Redis 封装（新建包）

**开发工具**：
- `vitest`：单元测试
- `tsup`：TypeScript 编译
- `tsx`：开发运行时

---

## 四、性能指标

**目标**：
- Redis 命令延迟：< 1ms
- Pub/Sub 消息延迟：< 5ms
- 会话读写延迟：< 2ms
- 广播延迟：< 10ms
- 单实例吞吐量：> 5,000 req/s
- 3 实例总吞吐量：> 15,000 req/s

---

## 五、风险与挑战

### 风险 1：Redis 单点故障

**问题**：Redis 宕机导致整个系统不可用

**应对方案**：
1. Redis 主从 + 哨兵（自动故障转移）
2. Redis Cluster（分片 + 高可用）
3. 本地缓存降级（Redis 不可用时使用内存缓存）

**建议**：生产环境使用 Redis Sentinel 或 Cluster

### 风险 2：网络分区

**问题**：实例与 Redis 之间网络中断

**应对方案**：
1. 本地缓存 + 最终一致性
2. 消息重试机制
3. 实例健康检查 + 自动摘除

**建议**：实现优雅降级，Redis 不可用时仍能处理本地请求

### 风险 3：数据一致性

**问题**：多实例并发修改导致数据不一致

**应对方案**：
1. 分布式锁保证原子性
2. Redis 事务（MULTI/EXEC）
3. 乐观锁（版本号机制）

**建议**：关键操作使用分布式锁，非关键操作使用最终一致性

---

## 六、里程碑

- **M1**：Redis 基础设施完成，能连接并执行基础命令
- **M2**：Pub/Sub 消息系统完成，能跨实例传递消息
- **M3**：分布式 Session 完成，会话跨实例共享
- **M4**：分布式广播完成，能向所有实例用户广播
- **M5**：分布式房间完成，房间状态跨实例同步
- **M6**：分布式锁完成，关键操作保证原子性
- **M7**：多实例部署配置完成，提供多种部署方式示例
- **M8**：集成 Demo 完成，所有场景验证通过
- **M9**：文档完成，Phase 3 交付

---

## 七、参考资料

- [ioredis 文档](https://github.com/luin/ioredis)
- [Redis Pub/Sub](https://redis.io/docs/manual/pubsub/)
- [Redis 分布式锁](https://redis.io/docs/manual/patterns/distributed-locks/)
- Phase 2 Review: `ai-docs/phase2-review.md`
