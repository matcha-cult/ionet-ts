import { describe, it, expect } from 'vitest';
import { AbstractAuthAction, type AuthCredentials } from './abstract-auth-action.js';
import type { UserInfo } from '../types/index.js';

class TestAuthAction extends AbstractAuthAction {
  events: string[] = [];

  protected async validateCredentials(credentials: AuthCredentials): Promise<UserInfo> {
    this.events.push('validate');
    if (credentials.password !== 'secret') {
      throw new Error('bad credentials');
    }
    return { id: 'u1', nickname: 'alice' };
  }

  protected async onLoginSuccess(user: UserInfo, token: string): Promise<void> {
    this.events.push('success:' + user.nickname);
  }

  protected async onLoginFailed(error: Error, credentials: AuthCredentials): Promise<void> {
    this.events.push('failed');
  }
}

describe('AbstractAuthAction', () => {
  it('logs in and issues a token', async () => {
    const action = new TestAuthAction();
    const result = await action.login({ username: 'alice', password: 'secret' });

    expect(result.user.nickname).toBe('alice');
    expect(result.token).toBeTruthy();
    expect(action.events).toEqual(['validate', 'success:alice']);
  });

  it('rejects bad credentials and fires onLoginFailed', async () => {
    const action = new TestAuthAction();

    await expect(action.login({ password: 'nope' })).rejects.toThrow('bad credentials');
    expect(action.events).toEqual(['validate', 'failed']);
  });

  it('resolves and destroys sessions by token', async () => {
    const action = new TestAuthAction();
    const { token } = await action.login({ password: 'secret' });

    await expect(action.resolveSession(token)).resolves.toBe('u1');
    await action.destroySession(token);
    await expect(action.resolveSession(token)).resolves.toBeNull();
  });
});
