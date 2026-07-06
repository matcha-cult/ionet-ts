# MMORPG Demo 设计文档

**目标**：实现一个最小可运行的 MMORPG demo，验证 ionet-ts 框架的 4 个逻辑服协同工作。

**模式**：一账户一角色（简化，不做多角色切换）

---

## 逻辑服划分

| 逻辑服 | Cmd | 职责 | 依赖 |
|--------|-----|------|------|
| LoginAction | 10 | 登录验证、Token 签发 | Redis（存储 session） |
| UserAction | 20 | 用户信息 CRUD、等级经验 | Redis（存储用户数据） |
| ItemAction | 30 | 道具增删改查、背包管理 | Redis（存储背包） |
| IdleAction | 40 | 放置队列、生产任务 | Redis（生产队列索引） |

---

## Cmd 路由表

### LoginAction (cmd=10)

| subCmd | 方法 | 参数 | 返回 | 说明 |
|--------|------|------|------|------|
| 1 | login | `{ account: string, password: string }` | `{ token: string, userId: bigint }` | 登录验证，签发 JWT |
| 2 | verify | `{ token: string }` | `{ userId: bigint, nickname: string }` | Token 校验 |

### UserAction (cmd=20)

| subCmd | 方法 | 参数 | 返回 | 说明 |
|--------|------|------|------|------|
| 1 | getUserInfo | `{ userId: bigint }` | `{ userId, nickname, level, exp }` | 查询用户信息 |
| 2 | updateNickname | `{ nickname: string }` | `{ success: boolean }` | 修改昵称 |
| 3 | addExp | `{ exp: number }` | `{ level: number, exp: number }` | 增加经验，自动升级 |

### ItemAction (cmd=30)

| subCmd | 方法 | 参数 | 返回 | 说明 |
|--------|------|------|------|------|
| 1 | getBag | `{}` | `{ items: Array<{ itemId, count }> }` | 查询背包 |
| 2 | addItem | `{ itemId: string, count: number }` | `{ success: boolean }` | 增加道具（内部调用） |
| 3 | useItem | `{ itemId: string, count: number }` | `{ success: boolean, effect: any }` | 使用道具 |

### IdleAction (cmd=40)

| subCmd | 方法 | 参数 | 返回 | 说明 |
|--------|------|------|------|------|
| 1 | startTask | `{ taskType: string }` | `{ success: boolean, startTime: number }` | 开始生产任务 |
| 2 | cancelTask | `{}` | `{ success: boolean }` | 取消当前任务 |
| 3 | getState | `{}` | `{ current, queue, inventory }` | 查询生产状态 |
| 4 | addToQueue | `{ taskType: string }` | `{ success: boolean, queueLength: number }` | 加入候选队列 |

---

## 数据模型

### Redis Key 设计

**LoginAction**:
- `session:{token}` → `{ userId, expireAt }` （String，TTL 7天）

**UserAction**:
- `user:{userId}` → Hash `{ nickname, level, exp, createdAt }`

**ItemAction**:
- `bag:{userId}` → Hash `{ itemId1: count1, itemId2: count2, ... }`

**IdleAction**（见 phase5-idle-production-queue.md）:
- `production:active` → ZSet `{ playerId: completeTime }`
- `player:{userId}:current` → Hash `{ type, startTime, duration }`
- `player:{userId}:queue` → List `[taskType1, taskType2, ...]`

---

## 核心流程

### 流程 1：登录

```
客户端 → LoginAction.login(account, password)
         ↓
         验证账号密码（demo 硬编码或查 DB）
         ↓
         生成 JWT token
         ↓
         Redis 存储 session: token → userId
         ↓
         返回 { token, userId }
         ↓
客户端保存 token，后续请求带 token
```

### 流程 2：生产任务完成 + 道具发放（持续生产）

```
IdleAction.startTask(taskType="wood")
         ↓
         写入 player:{userId}:current { type: "wood", startTime: now, duration: 3300 }
         ↓
         ZADD production:active score=now+3300 member=userId
         ↓
         返回 { success: true, startTime: now }
         
[3.3秒后，Worker tick 触发，无论玩家是否在线]
         ↓
         TimingWheel 拉取到期 userId
         ↓
         ProductionService.completeTask(userId)
           1. 读取 current，计算完成数量
           2. ItemService.addItem("wood", 1) → 发放到 Redis 背包
           3. 检查玩家在线状态
           4. LPOP queue，取下一个任务
           5. 如果有下一个，写入 current，ZADD 回时间轮
         ↓
         如果玩家在线：广播"获得 wood x1"
         如果玩家离线：静默发放（日志记录）
```

### 流程 3：离线生产

```
玩家下线 → 标记 player:{userId}:online = deleted
          记录 player:{userId}:lastOnline = now
          
[玩家离线期间，Worker 继续运行]
         ↓
         任务到期 → 发放道具到 Redis 背包
         ↓
         检查玩家在线状态 → 离线
         ↓
         静默发放（不广播）
         ↓
         自动取下一个任务继续生产
         
[玩家上线] → 标记 player:{userId}:online = "1"
            → 查看背包，发现离线期间已经获得了 N 个道具
```

---

## 逻辑服协同

### 跨服调用

IdleAction 任务完成时需要调用 ItemAction.addItem()：

**方案 1：直接调用（单进程 demo）**
```typescript
// IdleAction 内部
await this.itemAction.addItem(userId, itemId, count);
```

**方案 2：通过 FlowContext 跨服（分布式）**
```typescript
// IdleAction 发布事件
ctx.publishEvent('item.add', { userId, itemId, count });
// ItemAction 订阅事件
@OnEvent('item.add')
async onItemAdded(event: ItemAddEvent) { ... }
```

Demo 先用方案 1（简单），后续可切换到方案 2。

### Session 传递

登录成功后，token 通过 HTTP Header 或 WebSocket 帧传递：
- External Server 解析 token，提取 userId
- 写入 FlowContext.setUserId()
- Action 方法通过 ctx.getUserId() 获取

---

## 目录结构

```
demos/demo-mmorpg/
├── src/
│   ├── main.ts                    # 启动入口
│   ├── actions/
│   │   ├── login-action.ts        # 登录逻辑服
│   │   ├── user-action.ts         # 用户逻辑服
│   │   ├── item-action.ts         # 道具逻辑服
│   │   └── idle-action.ts         # 放置队列逻辑服
│   ├── services/
│   │   ├── auth-service.ts        # 认证服务（JWT）
│   │   ├── user-service.ts        # 用户数据服务
│   │   ├── item-service.ts        # 道具服务
│   │   └── production-service.ts  # 生产队列服务
│   ├── worker/
│   │   ├── timing-wheel.ts        # 时间轮
│   │   └── production-worker.ts   # 生产任务 worker
│   └── config/
│       └── task-config.ts         # 任务类型配置（wood=3.3s, cake=4.9s）
├── package.json
└── tsconfig.json
```

---

## 技术栈

- `@nbb-ionet/core-framework`：Action/FlowContext/装饰器
- `@nbb-ionet/redis`：RedisClient、DistributedLock
- `@nbb-ionet/external-server`：HTTP/WebSocket External Server
- `jsonwebtoken`：JWT 签发和验证
- `ioredis`：Redis 客户端（封装在 @nbb-ionet/redis 中）

---

## 任务清单

- [x] 创建 demos/demo-mmorpg/ 目录结构
- [x] 实现 LoginAction（登录、Token 签发）
- [x] 实现 UserAction（用户信息 CRUD）
- [x] 实现 ItemAction（背包管理）
- [x] 实现 IdleAction（生产队列）
- [x] 实现 TimingWheel（内存时间轮）
- [x] 实现 ProductionWorker（生产任务 worker）
- [x] 实现在线状态管理（onPlayerOnline/Offline）
- [x] 实现最大离线时间检查
- [x] 移除离线补偿逻辑（改为持续生产）
- [x] 编写 main.ts 启动入口
- [x] 编写测试客户端（curl 命令或 TS 脚本）
- [ ] 编写验收文档 demo-mmorpg-review.md

---

## 验收标准

1. 登录流程：账号密码 → Token → 后续请求带 Token
2. 用户信息：查询、修改昵称、增加经验自动升级
3. 道具系统：查询背包、增加道具、使用道具
4. 生产队列：开始任务 → 等待完成 → 自动发放道具
5. 候选队列：加入多个任务 → 自动接续
6. 离线补偿：下线一段时间 → 上线一次性补发
7. 性能：单 worker 支撑 1000 并发（demo 规模）

---

## 参考资料

- Phase 5 生产队列设计：`ai-docs/phase5-idle-production-queue.md`
- 现有 demo：`demos/demo/src/main.ts`
- Core Framework：`packages/core-framework/src/`
