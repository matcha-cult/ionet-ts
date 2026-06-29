import { describe, it, expect } from 'vitest';
import { FlowContext } from './core/flow/flow-context.js';
import { InMemorySessionStore, DefaultSessionManager } from './core/flow/session.js';

describe('FlowContext extensions', () => {
  it('get/set server info', () => {
    const ctx = new FlowContext();
    expect(ctx.getServer()).toBeNull();

    const serverInfo = { id: 'http-1', type: 'http' as const, port: 8080, host: 'localhost' };
    ctx.setServer(serverInfo);
    expect(ctx.getServer()).toEqual(serverInfo);
  });

  it('get/set session', () => {
    const ctx = new FlowContext();
    expect(ctx.getSession()).toBeNull();

    const session = { userId: 123n, createdAt: Date.now() };
    ctx.setSession(session);
    expect(ctx.getSession()).toBe(session);
    expect(ctx.getSession()!.userId).toBe(123n);
  });

  it('bindingUserId updates session', () => {
    const ctx = new FlowContext();
    const session = { userId: 0n, createdAt: Date.now() };
    ctx.setSession(session);

    ctx.bindingUserId(456n);
    expect(ctx.getUserId()).toBe(456n);
    expect(ctx.getSession()!.userId).toBe(456n);
  });

  it('attachments (get/set/remove/clear)', () => {
    const ctx = new FlowContext();

    ctx.setAttachment('user', { id: 1, name: 'Alice' });
    expect(ctx.getAttachment('user')).toEqual({ id: 1, name: 'Alice' });

    ctx.removeAttachment('user');
    expect(ctx.getAttachment('user')).toBeUndefined();

    ctx.setAttachment('a', 1);
    ctx.setAttachment('b', 2);
    ctx.clearAttachments();
    expect(ctx.getAttachment('a')).toBeUndefined();
    expect(ctx.getAttachment('b')).toBeUndefined();
  });

  it('request/response support headers', () => {
    const ctx = new FlowContext();

    const request = {
      cmd: 1,
      subCmd: 2,
      data: 'test',
      headers: { 'x-session-id': 'sess_123' },
    };
    ctx.setRequest(request);
    expect(ctx.getRequest()!.headers?.['x-session-id']).toBe('sess_123');

    const response = {
      data: { result: 'ok' },
      headers: { 'x-custom': 'value' },
    };
    ctx.setResponse(response);
    expect(ctx.getResponse()!.headers?.['x-custom']).toBe('value');
  });
});

describe('InMemorySessionStore', () => {
  it('set/get session', async () => {
    const store = new InMemorySessionStore();
    const data = { userId: 123n, createdAt: Date.now() };

    await store.set('sess_1', data);
    const retrieved = await store.get('sess_1');
    expect(retrieved).toEqual(data);
  });

  it('delete session', async () => {
    const store = new InMemorySessionStore();
    const data = { userId: 123n, createdAt: Date.now() };

    await store.set('sess_1', data);
    await store.delete('sess_1');
    expect(await store.get('sess_1')).toBeNull();
  });

  it('expired session returns null', async () => {
    const store = new InMemorySessionStore();
    const data = { userId: 123n, createdAt: Date.now() };

    await store.set('sess_1', data, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await store.get('sess_1')).toBeNull();
  });
});

describe('DefaultSessionManager', () => {
  it('creates and retrieves session', async () => {
    const store = new InMemorySessionStore();
    const manager = new DefaultSessionManager(store);
    const ctx = new FlowContext();
    ctx.setRequest({ cmd: 1, subCmd: 1, data: null });

    const sessionData = { userId: 789n, createdAt: Date.now() };
    await manager.saveSession(ctx, sessionData);

    const retrieved = await manager.getSession(ctx);
    expect(retrieved).toEqual(sessionData);
  });

  it('generates unique session IDs', () => {
    const store = new InMemorySessionStore();
    const manager = new DefaultSessionManager(store);

    const id1 = manager.generateSessionId();
    const id2 = manager.generateSessionId();
    expect(id1).not.toBe(id2);
    expect(id1.startsWith('sess_')).toBe(true);
  });
});
