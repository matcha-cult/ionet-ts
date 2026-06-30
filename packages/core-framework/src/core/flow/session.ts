import { type FlowContext } from './flow-context.js';

export interface SessionStore {
  get(sessionId: string): Promise<SessionData | null>;
  set(sessionId: string, data: SessionData, ttl?: number): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export interface SessionData {
  userId?: bigint;
  data?: Record<string, unknown>;
  createdAt: number;
  expiresAt?: number;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, { data: SessionData; expiresAt?: number }>();

  async get(sessionId: string): Promise<SessionData | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.expiresAt && Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session.data;
  }

  async set(sessionId: string, data: SessionData, ttl?: number): Promise<void> {
    const expiresAt = ttl ? Date.now() + ttl : undefined;
    this.sessions.set(sessionId, { data, expiresAt });
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt && now > session.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }
}

export interface SessionManager {
  getSession(ctx: FlowContext): Promise<SessionData | null>;
  saveSession(ctx: FlowContext, data: SessionData): Promise<void>;
  generateSessionId(): string;
}

export class DefaultSessionManager implements SessionManager {
  constructor(
    private readonly store: SessionStore,
    private readonly ttl = 24 * 60 * 60 * 1000,
  ) {}

  async getSession(ctx: FlowContext): Promise<SessionData | null> {
    const sessionId = this.getSessionId(ctx);
    if (!sessionId) return null;
    return this.store.get(sessionId);
  }

  async saveSession(ctx: FlowContext, data: SessionData): Promise<void> {
    let sessionId = this.getSessionId(ctx);
    if (!sessionId) {
      sessionId = this.generateSessionId();
      this.setSessionId(ctx, sessionId);
    }
    await this.store.set(sessionId, data, this.ttl);
  }

  generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  private getSessionId(ctx: FlowContext): string | null {
    const request = ctx.getRequest();
    if (!request) return null;

    const headers = request as any;
    return headers.headers?.['x-session-id'] ?? null;
  }

  private setSessionId(ctx: FlowContext, sessionId: string): void {
    const request = ctx.getRequest();
    if (!request) return;

    const headers = request as any;
    if (!headers.headers) {
      headers.headers = {};
    }
    headers.headers['x-session-id'] = sessionId;
  }
}
