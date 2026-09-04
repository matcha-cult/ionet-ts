# Phase 5 · 预制逻辑服

**目标**：提供一套开箱即用的游戏业务逻辑模板，加速游戏开发

**前置依赖**：Phase 4 已完成（扩展能力）

**设计理念**：
- 所有预制逻辑服都是**抽象类**，不能直接使用
- 开发者需要**继承**并实现具体的业务逻辑
- 提供默认实现和钩子方法，降低定制成本
- 遵循"约定优于配置"原则

---

## 可行性分析

### 参考 Java 版 ionet

Java 版 ionet 的 Room 扩展采用类似模式：

```java
// 抽象接口
public interface Room {
    Map<Long, Player> getPlayerMap();
    long getRoomId();
    int getSpaceSize();
    // ...
}

// 默认实现
public class SimpleRoom implements Room {
    final Map<Integer, Long> playerSeatMap = new TreeMap<>();
    final Map<Long, Player> playerMap = CollKit.ofConcurrentHashMap();
    // ...
}

// 业务扩展
public class ChessRoom extends SimpleRoom {
    @Override
    public void onPlayerJoin(Player player) {
        // 象棋特定的加入逻辑
    }
}
```

### TypeScript 实现方案

```typescript
// 抽象基类
export abstract class AbstractRoom {
  protected players = new Map<string, Player>();
  
  abstract onPlayerJoin(player: Player): Promise<void>;
  abstract onPlayerLeave(player: Player): Promise<void>;
  
  async join(player: Player): Promise<void> {
    this.players.set(player.id, player);
    await this.onPlayerJoin(player);
  }
}

// 具体实现
export class ChessRoom extends AbstractRoom {
  async onPlayerJoin(player: Player): Promise<void> {
    console.log(`Player ${player.name} joined chess room`);
    // 象棋特定逻辑
  }
}
```

**结论**：方案完全可行，且符合 TypeScript 的最佳实践。

---

## 模块设计

### 包名

`@nbb-ionet/extension-preset-logic`

### 目录结构

```
packages/extension-preset-logic/
├── src/
│   ├── auth/
│   │   ├── abstract-auth-action.ts      # 登录认证抽象
│   │   └── index.ts
│   ├── user/
│   │   ├── abstract-user-action.ts      # 用户管理抽象
│   │   ├── abstract-multi-role-action.ts # 多角色用户抽象
│   │   └── index.ts
│   ├── item/
│   │   ├── abstract-item.ts             # 物品基类
│   │   ├── abstract-bag-action.ts       # 背包系统抽象
│   │   ├── abstract-equip-action.ts     # 装备系统抽象
│   │   └── index.ts
│   ├── mail/
│   │   ├── abstract-mail-action.ts      # 邮件系统抽象
│   │   └── index.ts
│   ├── room/
│   │   ├── abstract-room.ts             # 抽象房间
│   │   ├── abstract-game-room.ts        # 抽象游戏房间
│   │   └── index.ts
│   ├── idle/
│   │   ├── abstract-idle-action.ts      # 放置类游戏抽象
│   │   └── index.ts
│   ├── types/
│   │   ├── player.ts                    # 玩家类型
│   │   ├── item.ts                      # 物品类型
│   │   ├── mail.ts                      # 邮件类型
│   │   └── index.ts
│   └── index.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

---

## 预制逻辑服详细设计

### 1. 登录认证 - AbstractAuthAction

**职责**：处理用户登录、Token 验证、Session 管理

**抽象方法**：
- `validateCredentials(credentials: any): Promise<UserInfo>` - 验证凭证
- `onLoginSuccess(user: UserInfo, session: Session): Promise<void>` - 登录成功钩子
- `onLoginFailed(error: Error): Promise<void>` - 登录失败钩子

**默认实现**：
- Token 解析和验证
- Session 创建和管理
- 登录日志记录

**示例**：
```typescript
export class MyAuthAction extends AbstractAuthAction {
  async validateCredentials(credentials: { username: string; password: string }) {
    // 从数据库验证用户
    const user = await this.userService.findByUsername(credentials.username);
    if (!user || user.password !== credentials.password) {
      throw new Error('Invalid credentials');
    }
    return user;
  }
  
  async onLoginSuccess(user: UserInfo, session: Session) {
    console.log(`User ${user.id} logged in`);
    // 发送登录奖励等
  }
}
```

---

### 2. 用户管理 - AbstractUserAction

**职责**：用户信息 CRUD、等级、经验、货币

**抽象方法**：
- `getUserData(userId: string): Promise<UserData>` - 获取用户数据
- `saveUserData(userId: string, data: UserData): Promise<void>` - 保存用户数据
- `onLevelUp(user: UserData, oldLevel: number, newLevel: number): Promise<void>` - 升级钩子

**默认实现**：
- 用户信息缓存
- 等级计算公式
- 货币增减操作

**示例**：
```typescript
export class MyUserAction extends AbstractUserAction {
  async getUserData(userId: string): Promise<UserData> {
    return await this.redis.get(`user:${userId}`);
  }
  
  async onLevelUp(user: UserData, oldLevel: number, newLevel: number) {
    // 发放升级奖励
    await this.mailService.sendSystemMail(user.id, {
      title: '升级奖励',
      content: `恭喜你升到${newLevel}级！`,
      attachments: [{ itemId: 'gold', count: newLevel * 100 }]
    });
  }
}
```

---

### 3. 多角色用户 - AbstractMultiRoleUserAction

**职责**：支持一个账号多个角色

**抽象方法**：
- `getRoles(accountId: string): Promise<Role[]>` - 获取角色列表
- `createRole(accountId: string, roleData: RoleData): Promise<Role>` - 创建角色
- `selectRole(accountId: string, roleId: string): Promise<void>` - 选择角色

**默认实现**：
- 角色列表管理
- 角色切换逻辑
- 角色数据隔离

---

### 4. 背包系统 - AbstractBagAction

**职责**：物品存储、增删改查、容量管理

**抽象方法**：
- `getBagSize(userId: string): Promise<number>` - 获取背包容量
- `onItemAdded(userId: string, item: Item, count: number): Promise<void>` - 物品添加钩子
- `onItemRemoved(userId: string, item: Item, count: number): Promise<void>` - 物品移除钩子

**默认实现**：
- 物品堆叠逻辑
- 背包容量检查
- 物品分类和排序

**示例**：
```typescript
export class MyBagAction extends AbstractBagAction {
  async getBagSize(userId: string): Promise<number> {
    const user = await this.getUserData(userId);
    return 100 + user.vipLevel * 20; // VIP 增加背包容量
  }
  
  async onItemAdded(userId: string, item: Item, count: number) {
    if (item.type === 'weapon') {
      // 触发成就检查
      await this.achievementService.checkWeaponCollection(userId);
    }
  }
}
```

---

### 5. 物品系统 - AbstractItem

**职责**：物品定义、使用逻辑、效果计算

**抽象方法**：
- `use(userId: string, context: UseContext): Promise<UseResult>` - 使用物品
- `canUse(userId: string, context: UseContext): Promise<boolean>` - 检查是否可用
- `getEffect(context: UseContext): Promise<Effect[]>` - 计算效果

**默认实现**：
- 物品类型判断
- 冷却时间检查
- 消耗品自动移除

---

### 6. 装备系统 - AbstractEquipAction

**职责**：装备穿戴、属性计算、强化升级

**抽象方法**：
- `getEquipSlots(userId: string): Promise<EquipSlot[]>` - 获取装备槽位
- `onEquipChanged(userId: string, slot: string, oldItem: Item, newItem: Item): Promise<void>` - 装备变更钩子
- `calculateAttributes(userId: string): Promise<Attributes>` - 计算总属性

**默认实现**：
- 装备槽位管理
- 属性叠加计算
- 装备等级限制

---

### 7. 邮件系统 - AbstractMailAction

**职责**：邮件发送、接收、附件领取

**抽象方法**：
- `getMailboxSize(userId: string): Promise<number>` - 获取邮箱容量
- `onMailReceived(userId: string, mail: Mail): Promise<void>` - 收到邮件钩子
- `onAttachmentClaimed(userId: string, mail: Mail, items: Item[]): Promise<void>` - 领取附件钩子

**默认实现**：
- 邮件列表管理
- 过期邮件清理
- 附件领取逻辑

---

### 8. 抽象房间 - AbstractRoom

**职责**：房间生命周期、玩家管理、游戏逻辑

**抽象方法**：
- `onPlayerJoin(player: Player): Promise<void>` - 玩家加入
- `onPlayerLeave(player: Player): Promise<void>` - 玩家离开
- `onGameStart(): Promise<void>` - 游戏开始
- `onGameEnd(result: GameResult): Promise<void>` - 游戏结束

**默认实现**：
- 玩家列表管理
- 房间状态同步
- 广播消息

**示例**：
```typescript
export class ChessRoom extends AbstractRoom {
  async onPlayerJoin(player: Player) {
    if (this.players.size >= 2) {
      await this.startGame();
    }
  }
  
  async onGameEnd(result: GameResult) {
    // 更新玩家积分
    await this.userService.updateRating(result.winner, +10);
    await this.userService.updateRating(result.loser, -10);
  }
}
```

---

### 9. 放置类游戏 - AbstractIdleAction

**职责**：离线收益、自动战斗、资源产出

**抽象方法**：
- `calculateOfflineReward(userId: string, offlineTime: number): Promise<Reward>` - 计算离线奖励
- `onAutoBattle(userId: string, battle: Battle): Promise<void>` - 自动战斗钩子
- `getResourceProduction(userId: string): Promise<Resource[]>` - 资源产出

**默认实现**：
- 离线时间计算
- 收益上限控制
- 自动战斗逻辑

---

## 依赖关系

```
@nbb-ionet/extension-preset-logic
├── @nbb-ionet/core-framework      # 核心框架
├── @nbb-ionet/redis               # Redis 支持（可选）
└── @nbb-ionet/extension-domain-event  # 领域事件（可选）
```

---

## 使用示例

### 完整的 RPG 游戏服务器

```typescript
import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';
import { AbstractAuthAction, AbstractUserAction, AbstractBagAction } from '@nbb-ionet/extension-preset-logic';

// 1. 登录认证
@ActionController(1)
export class AuthAction extends AbstractAuthAction {
  @ActionMethod(1)
  async login(credentials: { username: string; password: string }) {
    return this.validateAndLogin(credentials);
  }
  
  async validateCredentials(credentials) {
    // 从数据库验证
    return this.userService.verify(credentials);
  }
}

// 2. 用户管理
@ActionController(2)
export class UserAction extends AbstractUserAction {
  @ActionMethod(1)
  async getUserInfo(userId: string) {
    return this.getUserData(userId);
  }
  
  async onLevelUp(user, oldLevel, newLevel) {
    // 发放升级奖励
    await this.mailService.sendSystemMail(user.id, {
      title: '升级奖励',
      attachments: [{ itemId: 'gold', count: newLevel * 100 }]
    });
  }
}

// 3. 背包系统
@ActionController(3)
export class BagAction extends AbstractBagAction {
  @ActionMethod(1)
  async getItems(userId: string) {
    return this.getPlayerItems(userId);
  }
  
  async getBagSize(userId: string) {
    const user = await this.getUserData(userId);
    return 100 + user.vipLevel * 20;
  }
}

// 启动服务器
const skeleton = new BarSkeletonBuilder()
  .addAction(AuthAction)
  .addAction(UserAction)
  .addAction(BagAction)
  .build();
```

---

## 任务清单

### 任务 1：基础设施

- [x] 创建 `@nbb-ionet/extension-preset-logic` 包
  - [x] package.json, tsconfig.json, tsup.config.ts
  - [x] 依赖：@nbb-ionet/core-framework
- [x] 定义基础类型
  - [x] Player, UserInfo, Role
  - [x] Item, Equipment, Mail
  - [x] Room, GameResult

### 任务 2：用户系统

- [x] 实现 AbstractAuthAction
  - [x] 登录验证流程
  - [x] Session 管理
  - [x] 登录事件钩子
- [x] 实现 AbstractUserAction
  - [x] 用户数据 CRUD
  - [x] 等级经验计算
  - [x] 货币管理
- [x] 实现 AbstractMultiRoleUserAction
  - [x] 角色列表管理
  - [x] 角色创建和删除
  - [x] 角色切换

### 任务 3：物品系统

- [x] 实现 AbstractItem
  - [x] 物品使用逻辑
  - [x] 效果计算
  - [x] 冷却时间
- [x] 实现 AbstractBagAction
  - [x] 背包容量管理
  - [x] 物品增删改查
  - [x] 堆叠逻辑
- [x] 实现 AbstractEquipAction
  - [x] 装备槽位管理
  - [x] 属性计算
  - [x] 穿戴和卸下

### 任务 4：社交系统

- [x] 实现 AbstractMailAction
  - [x] 邮件发送和接收
  - [x] 附件管理
  - [x] 邮箱容量
- [x] 实现 AbstractRoom
  - [x] 房间生命周期
  - [x] 玩家管理
  - [x] 状态同步
- [x] 实现 AbstractGameRoom
  - [x] 游戏开始/结束
  - [x] 回合管理
  - [x] 胜负判定

### 任务 5：放置系统

- [x] 实现 AbstractIdleAction
  - [x] 离线收益计算
  - [x] 自动战斗
  - [x] 资源产出

### 任务 6：文档和示例

- [x] 编写使用文档
- [x] 创建完整示例项目
- [x] 编写 API 文档
- [x] 编写 `phase5-review.md`

---

## 里程碑

- **M1**：基础类型定义完成
- **M2**：用户系统完成（Auth + User + MultiRole）
- **M3**：物品系统完成（Item + Bag + Equip）
- **M4**：社交系统完成（Mail + Room + GameRoom）
- **M5**：放置系统完成（Idle）
- **M6**：文档和示例完成，Phase 5 交付

---

## 技术栈

**核心依赖**：
- `@nbb-ionet/core-framework`：核心框架
- `@nbb-ionet/redis`：分布式支持（可选）
- `@nbb-ionet/extension-domain-event`：领域事件（可选）

**开发工具**：
- `vitest`：单元测试
- `tsup`：TypeScript 编译
- `tsx`：开发运行时

---

## 风险与挑战

### 风险 1：抽象粒度

**问题**：抽象太细导致使用复杂，太粗导致灵活性不足

**应对方案**：
1. 提供多个层次：基础抽象类 + 高级抽象类
2. 提供丰富的钩子方法
3. 编写详细的定制指南

### 风险 2：依赖管理

**问题**：预制逻辑服之间可能有复杂的依赖关系

**应对方案**：
1. 使用依赖注入
2. 提供 Service Locator 模式
3. 明确依赖关系文档

### 风险 3：性能优化

**问题**：抽象层可能带来性能开销

**应对方案**：
1. 使用缓存减少重复计算
2. 批量操作优化
3. 提供性能测试基准

### 风险 4：TypeScript 特性限制

**问题**：TypeScript 的类和继承与 Java 有差异

**应对方案**：
1. 充分利用 TypeScript 的类型系统
2. 使用组合优于继承
3. 提供 Mixin 模式支持

---

## 参考资料

- [Java 版 ionet extension-room](https://github.com/iohao/ionet/tree/main/extension-room)
- [TypeScript 类与继承](https://www.typescriptlang.org/docs/handbook/classes.html)
- Phase 4 Review: `ai-docs/phase4-review.md`

---

## 与 Java 版的对比

| 特性 | Java 版 | TypeScript 版 |
|------|---------|---------------|
| 抽象方式 | 接口 + 抽象类 | 抽象类 + 可选接口 |
| 依赖注入 | Spring | 手动或 IoC 容器 |
| Lombok | 广泛使用 | 不常用 |
| 装饰器 | 无 | 支持 |
| 类型系统 | 强类型 | 强类型 + 结构化类型 |

**结论**：TypeScript 版可以借鉴 Java 版的设计思想，但需要充分利用 TypeScript 的语言特性（装饰器、结构化类型等）。
