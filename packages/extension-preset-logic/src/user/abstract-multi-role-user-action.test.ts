import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractMultiRoleUserAction, type RoleData } from './abstract-multi-role-user-action.js';
import type { Role, UserId } from '../types/index.js';
import { userIdKey } from '../types/index.js';

class TestMultiRoleAction extends AbstractMultiRoleUserAction {
  private readonly roles = new Map<string, Map<string, Role>>();
  private seq = 0;

  private bucket(accountId: UserId): Map<string, Role> {
    const key = userIdKey(accountId);
    let result = this.roles.get(key);
    if (!result) {
      result = new Map();
      this.roles.set(key, result);
    }
    return result;
  }

  protected async getRoles(accountId: UserId): Promise<Role[]> {
    return [...this.bucket(accountId).values()];
  }

  protected async createRole(accountId: UserId, roleData: RoleData): Promise<Role> {
    const role: Role = {
      id: 'r' + ++this.seq,
      accountId,
      name: roleData.name,
      level: roleData.level ?? 1,
      createdAt: this.seq,
    };
    this.bucket(accountId).set(userIdKey(role.id), role);
    return role;
  }

  protected async deleteRole(accountId: UserId, roleId: UserId): Promise<void> {
    this.bucket(accountId).delete(userIdKey(roleId));
  }

  protected async selectRole(accountId: UserId, roleId: UserId): Promise<void> {
    // persistence is a no-op in this test
  }
}

describe('AbstractMultiRoleUserAction', () => {
  let action: TestMultiRoleAction;

  beforeEach(() => {
    action = new TestMultiRoleAction();
  });

  it('creates and lists roles in order', async () => {
    const a = await action.addRole('acc1', { name: 'warrior' });
    const b = await action.addRole('acc1', { name: 'mage' });

    const list = await action.listRoles('acc1');
    expect(list.map((role) => role.id)).toEqual([a.id, b.id]);
  });

  it('switches and resolves the selected role with ownership check', async () => {
    const a = await action.addRole('acc1', { name: 'warrior' });
    const b = await action.addRole('acc2', { name: 'rogue' });

    await action.switchRole('acc1', a.id);
    await expect(action.getSelectedRole('acc1')).resolves.toMatchObject({ id: a.id });

    await expect(action.switchRole('acc1', b.id)).rejects.toThrow('does not belong');
  });

  it('removes roles and clears the selection', async () => {
    const a = await action.addRole('acc1', { name: 'warrior' });
    await action.switchRole('acc1', a.id);

    await action.removeRole('acc1', a.id);
    expect(await action.getSelectedRole('acc1')).toBeNull();
    expect(await action.listRoles('acc1')).toEqual([]);
  });
});
