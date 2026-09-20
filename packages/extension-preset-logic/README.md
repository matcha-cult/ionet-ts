# `@nbb-ionet/extension-preset-logic`

Preset game logic services for **ionet-ts**: a set of abstract Action templates for the
common building blocks of a game server (auth, user, items, mail, rooms, idle games).

Every class is an **abstract template**. You do not instantiate it directly — you inherit
from it, implement the protected hooks, and register the concrete subclass as an ionet
Action via `@ActionController` / `@ActionMethod`.

## Install

```bash
pnpm add @nbb-ionet/core-framework @nbb-ionet/extension-preset-logic
```

## Modules

| Module | Classes |
|---|---|
| auth | `AbstractAuthAction` |
| user | `AbstractUserAction`, `AbstractMultiRoleUserAction` |
| item | `AbstractItem`, `AbstractBagAction`, `AbstractEquipAction` |
| mail | `AbstractMailAction` |
| room | `AbstractRoom`, `AbstractGameRoom` |
| idle | `AbstractIdleAction` |

## Quick start

```ts
import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';
import { AbstractAuthAction, AbstractBagAction } from '@nbb-ionet/extension-preset-logic';

@ActionController(1)
export class AuthAction extends AbstractAuthAction {
  @ActionMethod(1)
  async login(data: { username: string; password: string }) {
    return this.login(data);
  }

  protected async validateCredentials(credentials: Record<string, unknown>) {
    if (credentials.password !== 'secret') {
      throw new Error('Invalid credentials');
    }
    return { id: 'u1', nickname: 'alice' };
  }
}

@ActionController(3)
export class BagAction extends AbstractBagAction {
  protected async getBagSize(userId: string | bigint): Promise<number> {
    return 100; // or load from user data
  }
}
```

## Concept: template method + hooks

Concrete subclasses fill in persistence and domain decisions; the abstract base provides
the fixed flow. For example `AbstractUserAction.addExp` handles the level curve and
persistence, then fires `onLevelUp` for your reward logic.

## IDs are storage-agnostic

`FlowContext.getUserId()` returns a `bigint`, while most backends key by `string`.
All preset hooks accept `UserId = string | bigint` and normalize internally with
`userIdKey`.

## Persistence hooks

Most stateful classes ship an in-memory default store and expose
`loadXxx` / `saveXxx` protected methods. Override them to persist to Redis, a
database, etc.

| Class | Load hook | Save hook |
|---|---|---|
| AbstractBagAction | loadBag | saveBag |
| AbstractEquipAction | loadEquipped | saveEquipped |
| AbstractMailAction | loadInbox | saveInbox |

## API summary

### AbstractAuthAction

| Member | Kind | Description |
|---|---|---|
| validateCredentials | abstract | verify credentials, return UserInfo or throw |
| issueToken | overridable | default randomUUID, replace with JWT |
| login | template | validate -> issue token -> create session -> onLoginSuccess |
| resolveSession / destroySession | template | session lookup and teardown |
| onLoginSuccess / onLoginFailed | hook | default no-op |

### AbstractUserAction

| Member | Kind | Description |
|---|---|---|
| getUserData / saveUserData | abstract | persistence |
| getUser / save | template | cached read and forced persist |
| addExp | template | auto-level with expRequiredForLevel |
| addCurrency / spendCurrency | template | balance management |
| onLevelUp | hook | default no-op |

### AbstractMultiRoleUserAction

| Member | Kind | Description |
|---|---|---|
| getRoles / createRole / deleteRole / selectRole | abstract | persistence |
| listRoles / addRole / removeRole | template | sorted list, create, delete |
| switchRole / getSelectedRole | template | ownership-checked selection |

### AbstractItem

| Member | Kind | Description |
|---|---|---|
| canUse / use | abstract | permission and effect |
| getEffect | overridable | default from definition.effects |
| tryUse | template | cooldown + canUse + use + effect merge |

### AbstractBagAction

| Member | Kind | Description |
|---|---|---|
| getBagSize | abstract | max slot count |
| loadBag / saveBag | overridable | persistence (in-memory default) |
| add / remove | template | capacity + stacking |
| list / getCount / usedSlots / totalCount | template | queries |
| onItemAdded / onItemRemoved | hook | default no-op |

### AbstractEquipAction

| Member | Kind | Description |
|---|---|---|
| getEquipSlots / calculateAttributes | abstract | slot defs and stat aggregation |
| loadEquipped / saveEquipped | overridable | persistence (in-memory default) |
| equip | template | level gate + slot assignment |
| unequip / listSlots / getEquipped / getAttributes | template | queries |
| onEquipChanged | hook | default no-op |

### AbstractMailAction

| Member | Kind | Description |
|---|---|---|
| getMailboxSize | abstract | active-mail capacity |
| loadInbox / saveInbox | overridable | persistence (in-memory default) |
| send / list / read | template | delivery, listing, read flag |
| claimAttachment | template | claim exactly once |
| onMailReceived / onAttachmentClaimed | hook | default no-op |

### AbstractRoom / AbstractGameRoom

| Member | Kind | Description |
|---|---|---|
| onPlayerJoin / onPlayerLeave | abstract | membership hooks |
| join / leave / getPlayerList / sendToRoom | template | membership + broadcast |
| onGameStart / onGameEnd | hook | default no-op (state transitions handled by startGame/endGame) |
| playTurn | abstract (game room) | one action; return GameResult to end |
| start / nextTurn / advanceTurn | template (game room) | gating, turn order, win resolution |

## Integration notes

- **Core framework** — decorate your concrete subclass with `@ActionController` /
  `@ActionMethod`; the preset classes never register routes themselves.
- **Redis (optional)** — override the `loadXxx` / `saveXxx` hooks with
  `@nbb-ionet/redis` calls. See `demos/demo-mmorpg` for a concrete, runnable example.
- **Domain events (optional)** — publish from the `onXxx` hooks using
  `@nbb-ionet/extension-domain-event` to decouple modules.

## License

MIT.
