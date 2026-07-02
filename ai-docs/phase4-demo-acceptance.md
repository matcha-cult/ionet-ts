# Phase 4 Demo 验收猜想

**日期**：2026-07-02
**阶段**：Phase 4 - 扩展能力
**状态**：验收猜想（待验证）

---

## 验收目标

验证 Phase 4 实现的 5 个扩展模块能否在真实场景中协同工作：

1. **Protobuf 编解码** - 高性能二进制协议
2. **Domain Event** - 领域事件系统
3. **代码生成** - 多语言客户端代码生成
4. **NestJS 集成** - NestJS Module 适配
5. **房间扩展** - 增强的房间功能

---

## 验收场景

### 场景：在线竞技游戏房间

**背景**：玩家通过客户端连接到游戏服务器，加入房间，进行实时对战。

**验收流程**：

1. **启动服务器**（NestJS + ionet）
   - 启动 NestJS 应用
   - 加载 ionet Module
   - 注册 Protobuf Codec
   - 启动 Domain EventBus
   - 初始化 DistributedRoomExtended

2. **客户端连接**
   - 使用生成的 TypeScript 客户端代码
   - 通过 WebSocket 连接
   - 登录认证（JWT）

3. **加入房间**
   - 玩家调用 `joinRoom(roomId)`
   - 触发 `onUserJoin` 事件钩子
   - 广播通知房间内其他玩家

4. **游戏对战**
   - 玩家发送游戏操作（Protobuf 编码）
   - 服务器解码操作，处理逻辑
   - 发布 Domain Event（如 `PlayerMoveEvent`）
   - 事件处理器更新房间状态
   - 广播更新后的状态给房间内所有玩家

5. **离开房间**
   - 玩家调用 `leaveRoom(roomId)`
   - 触发 `onUserLeave` 事件钩子
   - 清理房间状态

6. **代码生成验证**
   - 从 Action 定义生成 TypeScript、C#、GDScript、Lua 客户端代码
   - 验证生成的代码可以编译
   - 验证生成的类型与服务端一致

---

## 验收猜想

### 猜想 1：Protobuf 编解码性能提升

**假设**：使用 Protobuf 后，消息体积减少 50%+，编解码速度提升 30%+

**验证方法**：
1. 准备 1000 条游戏操作消息
2. 分别使用 JSON 和 Protobuf 编解码
3. 测量：
   - 编解码耗时（ms）
   - 消息体积（bytes）
   - 内存占用（MB）

**预期结果**：
- Protobuf 体积 < JSON 体积 * 0.5
- Protobuf 编码速度 > JSON 编码速度 * 1.3
- Protobuf 解码速度 > JSON 解码速度 * 1.2

---

### 猜想 2：Domain Event 并发隔离

**假设**：同一房间的事件串行处理，不同房间的事件并行处理

**验证方法**：
1. 创建 10 个房间，每个房间 10 个玩家
2. 每个玩家每秒发送 100 个事件
3. 验证：
   - 同一房间内事件按顺序处理（通过事件时间戳验证）
   - 不同房间的事件并行执行（通过处理时间验证）
   - 总吞吐量 > 100,000 events/s

**预期结果**：
- 同一房间事件顺序：event[n].timestamp < event[n+1].timestamp
- 不同房间处理时间：parallel_time < serial_time / 10
- 总吞吐量：> 100,000 events/s

---

### 猜想 3：代码生成类型安全

**假设**：生成的客户端代码类型与服务端一致，编译无错误

**验证方法**：
1. 定义 10 个 Action，包含基础类型、嵌套对象、数组
2. 生成 TypeScript 客户端代码
3. 验证：
   - TypeScript 编译通过
   - 生成的类型与服务端类型一致
   - 调用生成的 API 函数，参数类型检查通过

**预期结果**：
- TypeScript 编译：0 errors
- 类型匹配：100%
- 运行时调用：无类型错误

---

### 猜想 4：NestJS 集成无缝

**假设**：ionet 可以在 NestJS 中通过 Module 引入，支持依赖注入

**验证方法**：
1. 创建 NestJS 项目
2. 引入 IonetModule.forRoot()
3. 注册 Action（使用 @Injectable()）
4. 在 Action 中注入其他 NestJS Service
5. 验证：
   - 应用启动成功
   - 依赖注入工作正常
   - Action 可以调用注入的 Service

**预期结果**：
- 应用启动：无错误
- 依赖注入：Action 中可以访问注入的 Service
- 请求处理：Action 调用 Service 方法，返回正确结果

---

### 猜想 5：房间扩展功能完整

**假设**：房间支持角色、属性、事件钩子、范围广播

**验证方法**：
1. 创建房间，设置 owner/admin/member 角色
2. 修改房间属性（名称、最大人数）
3. 监听 onUserJoin/onUserLeave/onRoomMessage 事件
4. 调用 broadcastToRoom(roomId, data, excludeUserId)
5. 验证：
   - 角色权限正确（只有 owner 可以修改属性）
   - 事件钩子被触发
   - 广播消息被房间内所有玩家接收（除 excludeUserId）

**预期结果**：
- 角色权限：非 owner 修改属性时返回错误
- 事件钩子：每次操作都触发对应事件
- 范围广播：消息只发给目标玩家

---

## 验收步骤

### 前置条件

- Node.js >= 20
- pnpm >= 9
- Redis >= 7（demo-cluster 需要）
- 依赖已安装：`pnpm install`
- 已完成构建：`pnpm -w run build`

---

### Step 1：单元测试（验证各扩展模块）

```bash
# 运行所有包的测试
pnpm -r run test

# 或分别运行各扩展模块的测试
pnpm --filter @nbb-ionet/extension-jprotobuf run test
pnpm --filter @nbb-ionet/extension-domain-event run test
pnpm --filter @nbb-ionet/extension-codegen run test
pnpm --filter @nbb-ionet/extension-nestjs run test
pnpm --filter @nbb-ionet/redis run test
```

**预期结果**：所有测试通过（42+ tests）

---

### Step 2：NestJS 集成 Demo

```bash
# 启动 NestJS + ionet 服务器
pnpm --filter demo-nestjs start
```

**预期输出**：
```
=== NestJS + ionet Demo ===

✓ NestJS app initialized
✓ HTTP server started on http://localhost:8080
✓ WebSocket server started on ws://localhost:8081

ionet Endpoints:
  HTTP:  POST /api/{cmd}/{subCmd}
  WS:    Send JSON: { "cmd": number, "subCmd": number, "data": any }

Try:
  curl -X POST http://localhost:8080/api/1/1 -H "Content-Type: application/json" -d '{"data":"Alice"}'
  curl -X POST http://localhost:8080/api/1/2 -H "Content-Type: application/json" -d '{"data":12345}'
```

**验证**：
```bash
# 另一个终端执行
curl -X POST http://localhost:8080/api/1/1 \
  -H "Content-Type: application/json" \
  -d '{"data":"Alice"}'
# 预期返回: "Hello, Alice!"
```

---

### Step 3：代码生成 Demo

```bash
# 运行代码生成示例
pnpm --filter @nbb-ionet/demo-codegen run generate
```

**预期输出**：
```
=== Code Generation Demo ===

Scanned Actions:
  HallAction (cmd=1)
    - loginVerify (subCmd=1)
    - hello (subCmd=2)
  ChatAction (cmd=2)
    - sendMessage (subCmd=1)
    - getMessages (subCmd=2)

=== TypeScript ===
// ... 生成的 TypeScript 代码

=== C# ===
// ... 生成的 C# 代码

=== GDScript ===
// ... 生成的 GDScript 代码

=== Lua ===
// ... 生成的 Lua 代码
```

---

### Step 4：集群 Demo（需要 Redis）

```bash
# 确保 Redis 运行中
redis-server &

# 终端 1：启动 Instance 0
INSTANCE_INDEX=0 pnpm --filter @nbb-ionet/demo-cluster start

# 终端 2：启动 Instance 1
INSTANCE_INDEX=1 pnpm --filter @nbb-ionet/demo-cluster start

# 终端 3：运行游戏客户端（Alice 连 Instance 0，Bob 连 Instance 1）
pnpm --filter @nbb-ionet/demo-cluster run game
```

**预期输出（Instance 0）**：
```
=== ionet Phase 3 Cluster Demo ===
Instance Index: 0
HTTP: 8080, WS: 9080, Game: 9090

✓ Redis connected
✓ Game server (RPS) on :9090
✓ Instance registered
✓ HTTP server on :8080
✓ WebSocket server on :9080

Cluster has 2 instance(s)

Endpoints:
  Action HTTP : POST http://localhost:8080/api/{cmd}/{subCmd}
  Action WS   : ws://localhost:9080/ws
  Game (RPS)  : ws://localhost:9090
```

**预期输出（Game Client）**：
```
=== Rock Paper Scissors — Cross-Instance Demo ===

Player Alice → Instance 0 (port 9090)
Player Bob   → Instance 1 (port 9091)

  Alice: joined queue
  Bob: joined queue
  Alice: matched! gameId=xxx opponent=Bob
  Bob: matched! gameId=xxx opponent=Alice

--- Playing 5 rounds ---

  Alice: chose rock ✓
  Bob: chose scissors ✓
  Alice: round 1: rock vs scissors → WIN  scores=[1,0]
  Bob: round 1: scissors vs rock → LOSE  scores=[0,1]

--- Final results ---

  Alice: GAME OVER: WIN  score 3-2  (5 rounds)
  Bob: GAME OVER: LOSE  score 2-3  (5 rounds)

Done.
```

---

## 验收标准

### 必须通过（Must Have）

- [ ] Protobuf 编解码性能 > JSON（体积、速度）
- [ ] Domain Event 并发隔离工作正常（同房间串行，不同房间并行）
- [ ] 代码生成支持 4 种语言，生成的代码可编译
- [ ] NestJS 集成支持依赖注入
- [ ] 房间扩展支持角色、属性、事件钩子、范围广播

### 建议通过（Should Have）

- [ ] 端到端测试：客户端可以跨实例加入房间、发送消息、接收广播
- [ ] 性能测试：Domain Event 吞吐量 > 100,000 events/s
- [ ] 错误处理：异常情况有明确的错误提示

### 可选通过（Nice to Have）

- [ ] 全链路追踪：跨实例的请求可以追踪完整链路
- [ ] 监控指标：暴露性能指标（QPS、延迟、错误率）

---

## 风险与应对

### 风险 1：Protobuf 类型映射不准确

**问题**：某些 TypeScript 类型无法准确映射到 Protobuf 类型

**应对**：
- 提供详细的类型标注选项
- 使用自定义序列化器处理特殊类型
- 在文档中明确说明支持的类型子集

---

### 风险 2：Domain Event 内存占用过高

**问题**：高并发下分区队列可能占用大量内存

**应对**：
- 添加队列大小限制
- 实现背压机制
- 提供内存监控指标

---

### 风险 3：代码生成依赖 emitDecoratorMetadata

**问题**：某些打包工具（如 Vite）不支持 emitDecoratorMetadata

**应对**：
- 提供手动标注 API
- 在文档中说明支持的打包工具
- 提供 Vite 插件示例

---

### 风险 4：NestJS 版本兼容性问题

**问题**：NestJS 版本更新频繁，可能破坏兼容性

**应对**：
- 使用 peerDependencies 声明兼容版本
- 在多个 NestJS 版本上测试
- 保持适配层简洁，减少依赖

---

## 验收结论

**验收日期**：__________

**验收结果**：
- [ ] 通过（所有 Must Have 通过）
- [ ] 部分通过（部分 Must Have 未通过，需修复）
- [ ] 未通过（多个 Must Have 未通过，需重新设计）

**验收人**：__________

**备注**：
__________

---

## 附录

### A. 关键代码片段

#### Protobuf 装饰器

```typescript
@ProtobufClass
class PlayerMove {
  @ProtobufField(1, 'string')
  playerId: string;

  @ProtobufField(2, 'int32')
  x: number;

  @ProtobufField(3, 'int32')
  y: number;
}
```

#### Domain Event 发布

```typescript
const eventBus = new DomainEventBus();

eventBus.subscribe(PlayerMoveEvent, async (event) => {
  // 处理玩家移动事件
  console.log(`Player ${event.playerId} moved to (${event.x}, ${event.y})`);
});

await eventBus.publish(new PlayerMoveEvent('player1', 100, 200));
```

#### NestJS 集成

```typescript
@Module({
  imports: [
    IonetModule.forRoot({
      codec: new ProtobufProtocolCodec(),
    }),
  ],
})
class AppModule {}

@Injectable()
@ActionController(1)
class HallAction {
  constructor(private readonly userService: UserService) {}

  @ActionMethod(1)
  async login(jwt: string) {
    return this.userService.verify(jwt);
  }
}
```

#### 房间扩展

```typescript
const room = new DistributedRoomExtended(redisClient, pubSub);

room.onUserJoin((roomId, userId) => {
  console.log(`User ${userId} joined room ${roomId}`);
});

await room.broadcastToRoom('room1', { type: 'chat', message: 'hello' }, 'user1');
```

---

### B. 性能基准测试脚本

```bash
#!/bin/bash

echo "=== Protobuf Performance Test ==="
pnpm --filter @nbb-ionet/extension-jprotobuf test

echo "=== Domain Event Performance Test ==="
pnpm --filter @nbb-ionet/extension-domain-event test

echo "=== Room Extension Performance Test ==="
pnpm --filter @nbb-ionet/redis test distributed-room-extended

echo "=== End-to-End Test ==="
pnpm --filter @nbb-ionet/demo-cluster run game
```

---

**文档版本**：v1.0
**最后更新**：2026-07-02
