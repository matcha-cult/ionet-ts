# @nbb-ionet/demo-cluster

**Phase 3** 集群示例 - 展示 ionet 分布式集群能力，包含跨实例通信和多人对战游戏。

## 功能展示

### 核心功能

- **多实例部署**：通过 `INSTANCE_INDEX` 环境变量启动多个实例
- **Redis IPC**：基于 Redis Pub/Sub 的跨实例通信
- **分布式 Session**：Session 数据存储在 Redis，支持跨实例共享
- **分布式房间**：房间状态在 Redis 中管理，支持跨实例房间功能
- **分布式广播**：全局广播和房间范围广播
- **分布式锁**：基于 Redis 的分布式锁
- **实例发现**：自动注册和发现集群中的其他实例
- **优雅关闭**：正确处理进程终止信号

### 游戏 Demo

包含一个完整的石头剪刀布（Rock-Paper-Scissors）多人对战游戏：
- 跨实例玩家匹配
- 分布式游戏状态管理
- 实时对战（多轮制）
- 断线重连支持

## 前置条件

**必须运行 Redis 服务**：

```bash
# macOS
brew install redis
brew services start redis

# Linux (Ubuntu/Debian)
sudo apt-get install redis-server
sudo systemctl start redis

# Docker
docker run -d -p 6379:6379 redis:7-alpine

# 验证 Redis 运行
redis-cli ping  # 应返回 PONG
```

## 运行

### 1. 启动单实例

```bash
# 从项目根目录运行
pnpm --filter @nbb-ionet/demo-cluster start
```

### 2. 启动多实例集群

**终端 1 - Instance 0**：
```bash
INSTANCE_INDEX=0 pnpm --filter @nbb-ionet/demo-cluster start
```

**终端 2 - Instance 1**：
```bash
INSTANCE_INDEX=1 pnpm --filter @nbb-ionet/demo-cluster start
```

每个实例会启动三个服务：
- **Action HTTP**：`POST http://localhost:{8080+index}/api/{cmd}/{subCmd}`
- **Action WebSocket**：`ws://localhost:{9080+index}/ws`
- **Game Server**：`ws://localhost:{9090+index}`

### 3. 运行游戏客户端

```bash
# 需要先启动至少一个实例
pnpm --filter @nbb-ionet/demo-cluster run game
```

游戏客户端会自动：
- Alice 连接到 Instance 0（端口 9090）
- Bob 连接到 Instance 1（端口 9091）
- 进行跨实例匹配
- 对战 5 轮石头剪刀布
- 显示最终结果

## 预期输出

### Instance 0 启动

```
=== ionet Phase 3 Cluster Demo ===
Instance Index: 0
HTTP: 8080, WS: 9080, Game: 9090

✓ Redis connected (instance: instance-xxx-0)
✓ Game server (RPS) on :9090
✓ Instance registered: instance-xxx-0
✓ HTTP server on :8080
✓ WebSocket server on :9080

✓ Cluster has 1 instance(s)

Endpoints:
  Action HTTP : POST http://localhost:8080/api/{cmd}/{subCmd}
  Action WS   : ws://localhost:9080/ws
  Game (RPS)  : ws://localhost:9090

Run game demo:  pnpm --filter @nbb-ionet/demo-cluster run game
Press Ctrl+C to stop.
```

### Instance 1 启动（集群扩展）

```
=== ionet Phase 3 Cluster Demo ===
Instance Index: 1
HTTP: 8081, WS: 9081, Game: 9091

✓ Redis connected (instance: instance-xxx-1)
✓ Game server (RPS) on :9091
✓ Instance registered: instance-xxx-1
✓ HTTP server on :8081
✓ WebSocket server on :9081

✓ Cluster has 2 instance(s)
```

### 游戏客户端运行

```
=== Rock Paper Scissors — Cross-Instance Demo ===

Player Alice → Instance 0 (port 9090)
Player Bob   → Instance 1 (port 9091)

  [12:34:56] Alice: joined queue
  [12:34:56] Bob: joined queue
  [12:34:57] Alice: matched! gameId=abc12345 opponent=Bob
  [12:34:57] Bob: matched! gameId=abc12345 opponent=Alice
  [12:34:57] Alice: game start! round 1/5 choices=rock/paper/scissors
  [12:34:57] Bob: game start! round 1/5 choices=rock/paper/scissors

--- Playing 5 rounds ---

  [12:34:58] Alice: chose rock ✓
  [12:34:58] Bob: chose scissors ✓
  [12:34:58] Alice: round 1: rock vs scissors → WIN  scores=[1,0]
  [12:34:58] Bob: round 1: scissors vs rock → LOSE  scores=[0,1]

  [12:34:59] Alice: sending next...
  [12:34:59] Alice: next round ready
  [12:34:59] Alice: chose paper ✓
  [12:34:59] Bob: chose paper ✓
  [12:34:59] Alice: round 2: paper vs paper → DRAW  scores=[1,1]
  [12:34:59] Bob: round 2: paper vs paper → DRAW  scores=[1,1]

--- Final results ---

  [12:35:02] Alice: GAME OVER: WIN  score 3-2  (5 rounds)
  [12:35:02] Bob: GAME OVER: LOSE  score 2-3  (5 rounds)

Done.
```

## API 测试

### 1. 登录（cmd=1, subCmd=1）

```bash
curl -X POST http://localhost:8080/api/1/1 \
  -H "Content-Type: application/json" \
  -d '{"data":"test-jwt-token"}'

# 响应: {"data":{"id":1111,"nickname":"test-jwt-token"}}
```

### 2. Hello（cmd=1, subCmd=2）

```bash
curl -X POST http://localhost:8080/api/1/2 \
  -H "Content-Type: application/json" \
  -d '{"data":12345}'

# 响应: {"data":"hello 12345"}
```

### 3. 加入房间（cmd=1, subCmd=4）

```bash
curl -X POST http://localhost:8080/api/1/4 \
  -H "Content-Type: application/json" \
  -d '{"data":"room-001"}'

# 响应: {"data":{"joined":true,"roomId":"room-001"}}
```

### 4. 房间消息（cmd=1, subCmd=6）

```bash
curl -X POST http://localhost:8080/api/1/6 \
  -H "Content-Type: application/json" \
  -d '{"data":{"roomId":"room-001","message":"hello everyone"}}'

# 响应: {"data":{"sent":true}}
# Instance 日志会显示: [room:room-001] sender=xxx data={"roomId":"room-001","message":"hello everyone"}
```

## 环境变量

| 变量               | 默认值      | 说明                      |
|--------------------|-------------|---------------------------|
| `INSTANCE_INDEX`   | `0`         | 实例索引，用于计算端口号  |
| `HTTP_PORT`        | `8080`      | HTTP 基础端口             |
| `WS_PORT`          | `9080`      | WebSocket 基础端口        |
| `GAME_PORT`        | `9090`      | Game Server 基础端口      |
| `REDIS_HOST`       | `127.0.0.1` | Redis 主机                |
| `REDIS_PORT`       | `6379`      | Redis 端口                |
| `INSTANCE_ID`      | 自动生成    | 实例唯一标识              |

**端口计算规则**：`实际端口 = 基础端口 + INSTANCE_INDEX`

## 项目结构

```text
demo-cluster/
├── src/
│   ├── main.ts              # 入口，启动所有服务
│   └── game/
│       ├── types.ts         # 游戏类型定义
│       ├── game-server.ts   # 游戏服务器（跨实例匹配）
│       └── demo-client.ts   # 游戏客户端（Alice vs Bob）
├── package.json
├── tsconfig.json
└── README.md
```

## 架构说明

```text
┌─────────────┐         ┌─────────────┐
│  Instance 0 │         │  Instance 1 │
│  :8080/:9080│         │  :8081/:9081│
│  Game :9090 │         │  Game :9091 │
└──────┬──────┘         └──────┬──────┘
       │                       │
       └───────────┬───────────┘
                   │
              ┌────┴────┐
              │  Redis  │
              │ (IPC +  │
              │ Session │
              │ + Room) │
              └─────────┘
```

- **Redis Pub/Sub**：跨实例消息传递
- **Redis Keys**：分布式 Session、房间状态、游戏状态
- **Lua Scripts**：原子操作（创建游戏、匹配玩家）

## 故障排查

### Redis 连接失败

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**解决**：确保 Redis 服务正在运行。

### 端口被占用

```
Error: listen EADDRINUSE: address already in use :::8080
```

**解决**：
- 使用不同的 `INSTANCE_INDEX`
- 或修改基础端口：`HTTP_PORT=8090 INSTANCE_INDEX=0 pnpm start`

### 跨实例匹配失败

**检查**：
1. 两个实例都已启动并连接到同一 Redis
2. 实例日志显示 `Cluster has 2 instance(s)`
3. Redis 中可以看到实例注册信息：`redis-cli keys "ionet:instance:*"`

## 下一步

- [demo-codegen](../demo-codegen/) - 学习客户端代码生成
- [demo-nestjs](../demo-nestjs/) - 学习 NestJS 集成
- 阅读 [Phase 3 设计文档](../../ai-docs/phase3-distributed.md)
