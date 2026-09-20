# 放置游戏生产队列设计（修正版）

**归属**：Phase 5 · `extension-preset-logic` · `idle/` 模块

**目标**：在 ionet 逻辑服中实现高性能的放置游戏生产队列，支撑上万并发玩家。

**核心原则**：放置游戏的精髓是离线也在生产，道具持续发放。

---

## 核心约束

- 单玩家同时只有 **1 个活跃生产任务**，其余为 **候选队列**（预排队）
- 当前任务完成后，自动从候选队列取下一个开始
- **生产任务一旦开始，无论玩家是否在线，都会持续生产并发放道具**
- 玩家在线时：广播"获得物品"通知
- 玩家离线时：静默发放道具到背包（下次登录可见）
- 超过最大离线时间（24小时）才暂停生产

---

## 数据模型

### Redis 存储（4 个 key，极简）

| Key | 类型 | 用途 |
|-----|------|------|
| `production:active` | ZSet | 全局活跃任务索引，`member = playerId`，`score = 完成时间戳` |
| `player:{id}:current` | Hash | 玩家当前任务：`{ type, startTime, duration }` |
| `player:{id}:queue` | List | 玩家候选队列：`[taskType1, taskType2, ...]` |
| `player:{id}:online` | String | 玩家在线状态：`"1"` 表示在线 |
| `player:{id}:lastOnline` | String | 最后在线时间戳（用于检查最大离线时间） |

**为什么这样设计**：
- ZSet 的 score 天然支持 `ZRANGEBYSCORE` 拉取到期任务
- 单玩家只有 1 个 current，不需要跟踪"多个并行任务"
- 候选队列纯存储，不参与调度，只在 current 完成后 pop
- 在线状态用于决定是否广播，不影响生产逻辑

### TypeScript 侧

- **TimingWheel**：内存时间轮，tick 粒度 100ms，每个 slot 存 `Set<playerId>`
- **Worker 循环**：`setInterval` 每 100ms 触发，拉时间轮到期的 playerId 批次，批量处理

**为什么不用纯 Redis polling**：
- Redis `ZRANGEBYSCORE` 每 100ms 轮询也可以，但时间轮在内存侧过滤，减少 Redis 压力
- 时间轮适合"任务完成时间已知"的场景（生产队列正好符合）
- 如果重启丢状态，用 Redis ZSet 做补偿（启动时重建时间轮）

---

## 关键流程

### 流程 1：任务开始（玩家在线）

```
玩家 → IdleAction.startTask(taskType="wood")
         ↓
         写入 player:{userId}:current { type: "wood", startTime: now, duration: 3300 }
         ↓
         ZADD production:active score=now+3300 member=userId
         ↓
         加入 TimingWheel
         ↓
         返回 { success: true, startTime: now }
```

### 流程 2：任务完成（Worker 持续运行）

```
[3.3秒后，TimingWheel tick 触发]
         ↓
         ProductionWorker.processBatch([userId])
         ↓
         ProductionService.completeTask(userId)
           1. 读取 player:{userId}:current
           2. 计算完成数量 = 1
           3. ItemService.addItem("wood", 1) → 发放到 Redis 背包
           4. 检查玩家是否在线 (player:{userId}:online)
           5. LPOP player:{userId}:queue
           6. 如果有下一个，写入 current，ZADD 回时间轮
           7. 如果没有，清理 current
         ↓
         如果玩家在线：广播"获得 wood x1"
         如果玩家离线：静默发放（日志记录）
```

### 流程 3：玩家离线期间的生产

```
玩家下线 → 调用 IdleAction.onPlayerOffline()
           ↓
           删除 player:{userId}:online
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
           
[玩家上线] → 调用 IdleAction.onPlayerOnline()
            ↓
            设置 player:{userId}:online = "1"
            ↓
            查看背包，发现离线期间已经获得了 N 个道具
```

### 流程 4：最大离线时间检查

```
玩家上线 → IdleAction.getState()
         ↓
         检查 player:{userId}:lastOnline
         ↓
         如果离线时间 > 24小时：
           - 暂停当前生产任务
           - 提示"超过最大离线时间，生产已暂停"
         ↓
         如果离线时间 <= 24小时：
           - 正常显示状态（道具已经在离线期间发放了）
```

---

## 性能优化

### Redis 侧

1. **Pipeline 批量**：一次拉 500 个到期任务，单次 RTT
2. **原子操作**：发放 + 取下一个 + 更新 current 在一个事务内完成
3. **分片（可选）**：如果单 worker 瓶颈，按 `playerId % N` 分 N 个 worker

### TypeScript 侧

1. **时间轮内存优化**：用 `Map<number, Set<string>>`，tick 后及时 delete 过期 slot
2. **批次大小可调**：默认 500，根据实际 RTT 动态调整
3. **避免 GC 压力**：时间轮的 Set 复用，不要每次 tick 都 new Set

### 关键数字

- 5000 在线玩家 × 1 活跃任务 = 5000 个 ZSet 成员
- 100ms tick × 每 tick 500 个 = 每秒处理 5000，刚好覆盖
- 单 worker 处理 5000 个任务 ~500ms/秒，单 worker 足够
- **离线玩家的任务也在处理**，所以总任务数 = 在线玩家 + 离线玩家（但离线玩家不广播）

---

## 与旧设计的对比

| 特性 | 旧设计（上线才结算） | 新设计（持续生产） |
|------|---------------------|-------------------|
| 离线生产 | ❌ 暂停，上线一次性补发 | ✅ 持续生产，即时发放 |
| 道具发放时机 | 上线时批量发放 | 任务完成时即时发放 |
| 广播通知 | 无 | 在线时广播，离线时静默 |
| 最大离线时间 | 无限制 | 24小时（防止刷离线收益） |
| 玩家体验 | 离线无产出，失去放置游戏精髓 | 离线也在产出，符合放置游戏核心 |

---

## 任务清单

- [x] 实现 TimingWheel（内存时间轮，100ms tick）
- [x] 实现 ProductionService（任务管理 + 在线状态）
- [x] 实现 ProductionWorker（持续处理到期任务）
- [x] 实现在线状态管理（onPlayerOnline/Offline）
- [x] 实现最大离线时间检查
- [x] 移除离线补偿逻辑（改为持续生产）
- [x] 编写单元测试（时间轮、任务完成、在线状态）
- [x] 编写性能基准测试（模拟 5000 并发）

---

## 验收标准

1. 玩家下线任务不暂停，持续生产并发放道具
2. 玩家上线时，背包已经有离线期间产出的道具
3. 在线时广播"获得物品"，离线时静默发放
4. 超过 24 小时离线，生产暂停
5. 任务完成延迟 < 200ms（2 个 tick）
6. 单 worker 支撑 5000 并发（在线 + 离线）

---

## 参考资料

- MMORPG Demo 设计：`ai-docs/demo-mmorpg-design.md`
- Phase 5 预制逻辑服：`ai-docs/phase5-preset-logic.md`
