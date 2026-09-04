# Phase 5 · 预制逻辑服 — 交付回顾

**状态**：已完成（M1–M6）
**包**：`@nbb-ionet/extension-preset-logic`

## 目标回顾

按 `ai-docs/phase5-preset-logic.md` 提供一套开箱即用的游戏业务逻辑模板：全部以抽象类形式交付，
开发者继承并实现具体业务逻辑，底座提供默认实现与钩子方法。

## 交付清单

`packages/extension-preset-logic/`

| 模块 | 文件 | 职责 |
|---|---|---|
| 工程 | package.json / tsconfig.json / tsup.config.ts | pnpm workspace 包、tsup 双格式 + dts |
| types | types/common.ts, player.ts, item.ts, mail.ts, room.ts | UserId/Resource/Reward、Player/UserInfo/Role、Item/Effect/Equipment、Mail、RoomState/GameResult |
| auth | abstract-auth-action.ts | 登录模板：validateCredentials → issueToken → 会话 → 钩子 |
| user | abstract-user-action.ts | 用户 CRUD + 等级经验 + 货币 |
| user | abstract-multi-role-user-action.ts | 多角色：列表/创建/删除/切换/选中 |
| item | abstract-item.ts | 物品使用：冷却 + 权限 + 效果合并 |
| item | abstract-bag-action.ts | 背包：容量 + 堆叠 + 增删 |
| item | abstract-equip-action.ts | 装备：槽位 + 等级限制 + 属性聚合 |
| mail | abstract-mail-action.ts | 邮件：容量 + 过期清理 + 附件领取 |
| room | abstract-room.ts | 房间：成员生命周期 + 状态 + 广播 |
| room | abstract-game-room.ts | 游戏房间：开局门槛 + 回合 + 胜负 |
| idle | abstract-idle-action.ts | 放置：离线收益 + 自动战斗 + 产出 |

## 设计决策（与设计文档的差异说明）

1. **抽象类本身不注册路由**：预设类不添加 `@ActionController` / `@ActionMethod`，
   由具体子类声明路由并委托给模板方法（与设计文档"使用示例"一致）。

2. **`onItemAdded` / `onItemRemoved` 接收 `itemId` 而非 `Item` 定义**：
   避免在抽象类中硬性引入物品目录解析；需要定义级信息的场景由具体实现自行查询目录。
   同时把二者从"抽象方法"改为"可覆盖钩子（默认 no-op）"，额外引入 `loadBag/saveBag` 持久化钩子。

3. **`AbstractRoom` 的 `onGameStart/onGameEnd`**：设计文档列为抽象方法，实现为可覆盖钩子
   （默认 no-op），状态切换由 `startGame/endGame` 模板方法完成，使非游戏房间也能直接继承。

4. **`UserId = string | bigint`**：框架 `FlowContext.getUserId()` 返回 bigint，而存储偏向 string；
   统一接受二者并通过 `userIdKey` 归一化，与 demo 既有 bigint 用法兼容。

5. **持久化钩子内建 in-memory 默认实现**：`loadBag/saveBag`、`loadEquipped/saveEquipped`、
   `loadInbox/saveInbox` 默认内存存储，Redis/DB 通过覆盖接入（可选依赖，未硬依赖 `@nbb-ionet/redis`）。

6. **`AbstractIdleAction` 新增 `Battle` 类型**与可注入的 `now()` 时钟，便于确定性测试离线收益封顶。

## 测试覆盖

vitest 2.1：**10 个测试文件、41 个用例，全绿**。

| 模块 | 用例 |
|---|---|
| auth | 3 |
| user | 4 |
| multi-role | 3 |
| item | 3 |
| bag | 5 |
| equip | 5 |
| mail | 5 |
| room | 4 |
| game-room | 5 |
| idle | 4 |

## 构建结果

`pnpm --filter @nbb-ionet/extension-preset-logic build`：tsup CJS + ESM + DTS 全部成功，
产出 dist/index.js / index.cjs / index.d.ts。

## 未覆盖项（后续可做）

- 未新增独立可运行 demo 包（完整示例以 README 快速上手 + 既有 `demos/demo-mmorpg` 为参照）。
- `TcpExternalServer`（本次按用户决策保持"推迟"，属 Phase 2 可选项）。
- `demo-mmorpg-review.md` 验收文档（本次范围外，属 demo-mmorpg 遗留项）。

## 下一步建议

1. 将 demo-mmorpg 的具体 Action 改写为继承 preset-logic 抽象类，作为端到端示例。
2. 新增 `demos/demo-preset-logic` 可运行示例（如需）。
3. 为 Redis 持久化提供现成的 `RedisBagStore` 等适配器。
