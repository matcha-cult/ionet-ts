import type { Role, UserId } from '../types/index.js';
import { userIdKey } from '../types/index.js';

export interface RoleData {
  name: string;
  level?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Template method for accounts that own multiple selectable roles/characters.
 * Tracks the currently selected role per account and enforces ownership.
 */
export abstract class AbstractMultiRoleUserAction {
  private readonly selected = new Map<string, UserId>();

  /** Load the roles belonging to an account. */
  protected abstract getRoles(accountId: UserId): Promise<Role[]>;

  /** Persist a new role and return it (with its generated id). */
  protected abstract createRole(accountId: UserId, roleData: RoleData): Promise<Role>;

  /** Persist removal of a role. */
  protected abstract deleteRole(accountId: UserId, roleId: UserId): Promise<void>;

  /** Persist the selected role for an account. */
  protected abstract selectRole(accountId: UserId, roleId: UserId): Promise<void>;

  /** Invoked after creating a role. Default no-op. */
  protected onRoleCreated(accountId: UserId, role: Role): void | Promise<void> {
    return undefined;
  }

  /** Invoked after selecting a role. Default no-op. */
  protected onRoleSelected(accountId: UserId, roleId: UserId): void | Promise<void> {
    return undefined;
  }

  /** Invoked after deleting a role. Default no-op. */
  protected onRoleDeleted(accountId: UserId, roleId: UserId): void | Promise<void> {
    return undefined;
  }

  /** List roles sorted by creation time. */
  async listRoles(accountId: UserId): Promise<Role[]> {
    const roles = await this.getRoles(accountId);
    return [...roles].sort((a, b) => a.createdAt - b.createdAt);
  }

  async addRole(accountId: UserId, roleData: RoleData): Promise<Role> {
    const role = await this.createRole(accountId, roleData);
    await this.onRoleCreated(accountId, role);
    return role;
  }

  async removeRole(accountId: UserId, roleId: UserId): Promise<void> {
    await this.deleteRole(accountId, roleId);
    const key = userIdKey(accountId);
    const current = this.selected.get(key);
    if (current !== undefined && userIdKey(current) === userIdKey(roleId)) {
      this.selected.delete(key);
    }
    await this.onRoleDeleted(accountId, roleId);
  }

  /** Validate ownership, then persist and track the selected role. */
  async switchRole(accountId: UserId, roleId: UserId): Promise<void> {
    const roles = await this.getRoles(accountId);
    const owned = roles.some((role) => userIdKey(role.id) === userIdKey(roleId));
    if (!owned) {
      throw new Error('Role does not belong to account');
    }
    await this.selectRole(accountId, roleId);
    this.selected.set(userIdKey(accountId), roleId);
    await this.onRoleSelected(accountId, roleId);
  }

  /** Resolve the currently selected role for an account, if any. */
  async getSelectedRole(accountId: UserId): Promise<Role | null> {
    const roleId = this.selected.get(userIdKey(accountId));
    if (roleId === undefined) return null;
    const roles = await this.getRoles(accountId);
    return roles.find((role) => userIdKey(role.id) === userIdKey(roleId)) ?? null;
  }
}
