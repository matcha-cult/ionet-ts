import { randomUUID } from 'node:crypto';
import type { UserId, UserInfo } from '../types/index.js';

export type AuthCredentials = Record<string, unknown>;

export interface LoginResult {
  token: string;
  user: UserInfo;
}

interface SessionRecord {
  userId: UserId;
  expiresAt?: number;
}

/**
 * Template method for login flows: validate credentials, issue a token,
 * track a session, and expose success/failure hooks for domain logic.
 *
 * Concrete actions add their route via @ActionController / @ActionMethod
 * and delegate the payload to {@link login}.
 */
export abstract class AbstractAuthAction {
  private readonly sessions = new Map<string, SessionRecord>();

  /**
   * Validate credentials and return the authenticated user.
   * Throw an Error to reject the login attempt.
   */
  protected abstract validateCredentials(credentials: AuthCredentials): Promise<UserInfo>;

  /** Invoked after a successful login. Default no-op. */
  protected onLoginSuccess(user: UserInfo, token: string): void | Promise<void> {
    return undefined;
  }

  /** Invoked after a failed login. Default no-op. */
  protected onLoginFailed(error: Error, credentials: AuthCredentials): void | Promise<void> {
    return undefined;
  }

  /** Issue an opaque token. Override to use JWT or any signed scheme. */
  protected issueToken(user: UserInfo): string | Promise<string> {
    return randomUUID();
  }

  /** Session default TTL in milliseconds. Override; return 0 for non-expiring. */
  protected get sessionTtlMs(): number | undefined {
    return 7 * 24 * 60 * 60 * 1000;
  }

  /** Validate credentials then issue a token and record a session. */
  async login(credentials: AuthCredentials): Promise<LoginResult> {
    try {
      const user = await this.validateCredentials(credentials);
      const token = await this.issueToken(user);
      await this.createSession(token, user.id);
      await this.onLoginSuccess(user, token);
      return { token, user };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.onLoginFailed(err, credentials);
      throw err;
    }
  }

  protected async createSession(token: string, userId: UserId): Promise<void> {
    const ttl = this.sessionTtlMs;
    const expiresAt = ttl && ttl > 0 ? Date.now() + ttl : undefined;
    this.sessions.set(token, { userId, expiresAt });
  }

  /** Resolve a token to a user id, honoring session TTL. */
  async resolveSession(token: string): Promise<UserId | null> {
    const record = this.sessions.get(token);
    if (!record) return null;
    if (record.expiresAt && Date.now() > record.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return record.userId;
  }

  async destroySession(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}
