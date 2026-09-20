// Minimal runnable example: auth + user + bag built on the preset templates.
// Run from the package directory:  npx tsx examples/basic-rpg.ts
import {
  AbstractAuthAction,
  AbstractBagAction,
  AbstractUserAction,
} from '../src/index.js';
import type { UserData, UserId, UserInfo } from '../src/index.js';

class AuthAction extends AbstractAuthAction {
  protected async validateCredentials(credentials: Record<string, unknown>): Promise<UserInfo> {
    if (credentials.password !== 'secret') {
      throw new Error('Invalid credentials');
    }
    return { id: 'u1', nickname: 'alice' };
  }
}

class UserAction extends AbstractUserAction {
  private readonly store = new Map<string, UserData>();

  protected async getUserData(userId: UserId): Promise<UserData> {
    const key = String(userId);
    const existing = this.store.get(key);
    if (existing) return existing;
    const data: UserData = {
      id: userId,
      nickname: 'alice',
      level: 1,
      exp: 0,
      currencies: { gold: 0 },
      createdAt: Date.now(),
    };
    this.store.set(key, data);
    return data;
  }

  protected async saveUserData(userId: UserId, data: UserData): Promise<void> {
    this.store.set(String(userId), data);
  }
}

class BagAction extends AbstractBagAction {
  protected async getBagSize(userId: UserId): Promise<number> {
    return 100;
  }
}

async function main(): Promise<void> {
  const auth = new AuthAction();
  const user = new UserAction();
  const bag = new BagAction();

  const login = await auth.login({ account: 'alice', password: 'secret' });
  console.log('[auth]', login.user.nickname, 'token:', login.token.slice(0, 8) + '...');

  await user.addExp('u1', 250);
  const profile = await user.getUser('u1');
  console.log('[user] level:', profile.level, 'exp:', profile.exp);

  await bag.add('u1', 'wood', 2);
  await bag.add('u1', 'wood', 3);
  console.log('[bag]', JSON.stringify(await bag.list('u1')));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
