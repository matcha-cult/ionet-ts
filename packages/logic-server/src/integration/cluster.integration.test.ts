import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import {
  ConnectionRegistryStore,
  RedisClient,
  RedisPubSub,
  RedisRequestReply,
  ServerRegistry,
} from '@nbb-ionet/redis';

/**
 * 多进程集成测试（验收核心）：
 *   2 个逻辑服进程（battle/map）+ 1 个对外服进程 + 真实 Redis。
 *
 * 覆盖 RS1（无端口逻辑服宿主）、RS2（注册/发现/下线）、RS3（分布式路由 + 未注册显式报错）、
 * RS4（RPC 超时/对端崩溃）、RS5（FlowContext.call/send）、RS6（OnExternal 推送/强下线）、
 * RS8（跨进程重复路由检测）。
 *
 * 前置：`pnpm -w run build`（子进程经 tsx 加载本包源码与已构建的依赖包）；
 *       本机 Redis 可用（默认 127.0.0.1:6379）。
 */

const PKG_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LOGIC_HARNESS = fileURLToPath(new URL('./logic-server-harness.ts', import.meta.url));
const EXTERNAL_HARNESS = fileURLToPath(new URL('./external-server-harness.ts', import.meta.url));
const DOUBLE_REPLY_HARNESS = fileURLToPath(new URL('./double-reply-harness.ts', import.meta.url));

/**
 * 用 `node --import tsx`（同进程 loader）而非 `tsx` CLI 启动 harness：
 * tsx CLI 会再 spawn 一个子进程，SIGKILL 只杀掉 CLI 而 harness 存活，
 * 导致「对端崩溃」类测试失真。
 */
const TSX_LOADER_ARGS = ['--import', 'tsx'];

const REDIS_PORT = Number(process.env.IONET_TEST_REDIS_PORT ?? 6379);
const HEARTBEAT_MS = 200;
const HEARTBEAT_TIMEOUT_MS = 1500;

interface ReadyInfo {
  instanceId: string;
  name?: string;
  tag?: string;
  cmdMerges?: number[];
  port?: number;
}

interface Harness {
  child: ChildProcess;
  ready: ReadyInfo;
  output: () => string;
}

function runId(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function spawnHarness(
  harness: string,
  env: Record<string, string>,
): { child: ChildProcess; output: () => string } {
  const child = spawn(process.execPath, [...TSX_LOADER_ARGS, harness], {
    cwd: PKG_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buffer = '';
  child.stdout!.on('data', (data) => {
    buffer += data.toString();
  });
  child.stderr!.on('data', (data) => {
    buffer += data.toString();
  });
  return { child, output: () => buffer };
}

function waitForReady(spawned: { child: ChildProcess; output: () => string }, timeoutMs = 25000): Promise<ReadyInfo> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      const text = spawned.output();
      const match = text.match(/READY (\{[^\n]*\})/);
      if (match) {
        clearInterval(poll);
        resolve(JSON.parse(match[1]) as ReadyInfo);
        return;
      }
      if (spawned.child.exitCode !== null) {
        clearInterval(poll);
        reject(new Error(`harness exited early code=${spawned.child.exitCode}\n${text}`));
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(poll);
        reject(new Error(`harness READY timeout\n${text}`));
      }
    }, 50);
  });
}

async function waitForExit(child: ChildProcess, timeoutMs = 10000): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('process exit timeout'));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

class Cluster {
  private readonly children: ChildProcess[] = [];
  readonly prefix: string;
  readonly runId: string;

  constructor(tag: string) {
    this.runId = `${tag}-${runId()}`;
    this.prefix = `ionet-test-${this.runId}:`;
  }

  async startLogic(role: 'battle' | 'map' | 'dupbattle', instanceId: string, heartbeatTimeoutMs = HEARTBEAT_TIMEOUT_MS): Promise<Harness> {
    const spawned = spawnHarness(LOGIC_HARNESS, {
      IONET_ROLE: role,
      IONET_INSTANCE_ID: instanceId,
      IONET_KEY_PREFIX: this.prefix,
      IONET_REDIS_PORT: String(REDIS_PORT),
      IONET_HEARTBEAT_MS: String(HEARTBEAT_MS),
      IONET_HEARTBEAT_TIMEOUT_MS: String(heartbeatTimeoutMs),
    });
    this.children.push(spawned.child);
    const ready = await waitForReady(spawned);
    return { child: spawned.child, ready, output: spawned.output };
  }

  async startExternal(instanceId: string): Promise<Harness & { port: number }> {
    const port = await getFreePort();
    const spawned = spawnHarness(EXTERNAL_HARNESS, {
      IONET_INSTANCE_ID: instanceId,
      IONET_PORT: String(port),
      IONET_KEY_PREFIX: this.prefix,
      IONET_REDIS_PORT: String(REDIS_PORT),
      IONET_HEARTBEAT_MS: String(HEARTBEAT_MS),
      IONET_HEARTBEAT_TIMEOUT_MS: String(HEARTBEAT_TIMEOUT_MS),
    });
    this.children.push(spawned.child);
    const ready = await waitForReady(spawned);
    return { child: spawned.child, ready, output: spawned.output, port };
  }

  spawnDuplicate(instanceId: string): { child: ChildProcess; output: () => string } {
    const spawned = spawnHarness(LOGIC_HARNESS, {
      IONET_ROLE: 'dupbattle',
      IONET_INSTANCE_ID: instanceId,
      IONET_KEY_PREFIX: this.prefix,
      IONET_REDIS_PORT: String(REDIS_PORT),
      IONET_HEARTBEAT_MS: String(HEARTBEAT_MS),
      IONET_HEARTBEAT_TIMEOUT_MS: String(HEARTBEAT_TIMEOUT_MS),
    });
    this.children.push(spawned.child);
    return spawned;
  }

  async stop(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    try {
      await waitForExit(child, 8000);
    } catch {
      child.kill('SIGKILL');
    }
  }

  async stopAll(): Promise<void> {
    for (const child of this.children) {
      if (child.exitCode === null) child.kill('SIGTERM');
    }
    await Promise.all(
      this.children.map((child) => waitForExit(child, 8000).catch(() => child.kill('SIGKILL'))),
    );
  }
}

interface ResponseEnvelope {
  kind?: string;
  reqId?: string;
  data?: unknown;
  errorCode?: number;
  errorMessage?: string;
}

class TestClient {
  private seq = 0;
  private readonly pending = new Map<string, { resolve: (v: ResponseEnvelope) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly notifications: Array<Record<string, unknown>> = [];
  private readonly notificationWaiters: Array<(value: Record<string, unknown>) => void> = [];
  private closed = false;
  private closeWaiters: Array<() => void> = [];

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => this.onMessage(JSON.parse(raw.toString())));
    ws.on('close', () => {
      this.closed = true;
      for (const waiter of this.closeWaiters) waiter();
      this.closeWaiters = [];
    });
  }

  static connect(port: number, userId: string): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?userId=${userId}`);
    const client = new TestClient(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  request(cmd: number, subCmd: number, data?: unknown, timeoutMs = 8000): Promise<ResponseEnvelope> {
    const reqId = `r-${++this.seq}`;
    return new Promise<ResponseEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`client request timeout cmd=${cmd} subCmd=${subCmd}`));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, timer });
      this.ws.send(JSON.stringify({ cmd, subCmd, data, reqId, kind: 'request' }));
    });
  }

  waitForNotification(type: string, timeoutMs = 8000): Promise<Record<string, unknown>> {
    const existing = this.notifications.find((n) => n.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`notification timeout: ${type}`)), timeoutMs);
      this.notificationWaiters.push((value) => {
        if (value.type !== type) return;
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  waitForClose(timeoutMs = 8000): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('close timeout')), timeoutMs);
      this.closeWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close(): void {
    this.ws.close();
  }

  private onMessage(message: Record<string, unknown>): void {
    const reqId = message.reqId as string | undefined;
    if (reqId && this.pending.has(reqId)) {
      const pending = this.pending.get(reqId)!;
      clearTimeout(pending.timer);
      this.pending.delete(reqId);
      pending.resolve(message as ResponseEnvelope);
      return;
    }
    this.notifications.push(message);
    this.notificationWaiters = this.notificationWaiters.filter((waiter) => {
      waiter(message);
      return false;
    });
  }
}

/** 测试进程内的注册表/连接表检查器。 */
class Inspector {
  private client!: RedisClient;
  private pubSub!: RedisPubSub;
  registry!: ServerRegistry;
  connectionStore!: ConnectionRegistryStore;

  async start(prefix: string): Promise<void> {
    this.client = new RedisClient({ instanceId: `inspector-${runId()}` });
    await this.client.connect();
    this.pubSub = new RedisPubSub(this.client);
    await this.pubSub.connect();
    this.registry = new ServerRegistry(this.client, this.pubSub, {
      keyPrefix: prefix,
      heartbeatIntervalMs: HEARTBEAT_MS,
      heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
      cacheTtlMs: 0,
    });
    await this.registry.start();
    this.connectionStore = new ConnectionRegistryStore(this.client, { keyPrefix: prefix });
  }

  async stop(): Promise<void> {
    await this.registry.stop().catch(() => {});
    await this.pubSub.disconnect().catch(() => {});
    await this.client.disconnect().catch(() => {});
  }
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 8000, intervalMs = 80): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('waitUntil timeout');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('RS1/RS2/RS3/RS5 多进程路由与跨服调用', () => {
  const cluster = new Cluster('routing');
  const inspector = new Inspector();
  let battle: Harness;
  let map: Harness;
  let external: Harness & { port: number };

  beforeAll(async () => {
    await inspector.start(cluster.prefix);
    battle = await cluster.startLogic('battle', `battle-${cluster.runId}`);
    map = await cluster.startLogic('map', `map-${cluster.runId}`);
    external = await cluster.startExternal(`external-${cluster.runId}`);
  }, 60000);

  afterAll(async () => {
    await cluster.stopAll();
    await inspector.stop();
  }, 30000);

  it('RS1/RS3：对外服无本地 Action，请求跨进程转发到 battle 逻辑服', async () => {
    const client = await TestClient.connect(external.port, '1001');
    const response = await client.request(101, 1, { hello: 'world' });
    expect(response.errorCode).toBeUndefined();
    expect(response.data).toEqual({ server: 'battle', value: { hello: 'world' } });
    client.close();
  }, 20000);

  it('RS5：battle 逻辑服内 FlowContext.call 同步调用 map 逻辑服', async () => {
    const client = await TestClient.connect(external.port, '1002');
    const response = await client.request(101, 2, { req: 'info' });
    expect(response.errorCode).toBeUndefined();
    expect(response.data).toEqual({
      fromBattle: true,
      map: { server: 'map', map: 'map-1', value: { req: 'info' } },
    });
    client.close();
  }, 20000);

  it('RS4：跨服调用超时显式返回 504（callAsync 错误信封）', async () => {
    const client = await TestClient.connect(external.port, '1003');
    const response = await client.request(101, 6, { ms: 600, timeoutMs: 120 });
    expect(response.errorCode).toBeUndefined();
    expect(response.data).toMatchObject({ errorCode: 504 });
    expect(String((response.data as { errorMessage: string }).errorMessage)).toContain('timeout');
    client.close();
  }, 20000);

  it('RS3：未注册路由显式报错 503（不得静默 404）', async () => {
    const client = await TestClient.connect(external.port, '1004');
    const response = await client.request(999, 1, {});
    expect(response.errorCode).toBe(503);
    expect(response.errorMessage).toContain('No logic server registered');
    expect(response.errorCode).not.toBe(404);
    client.close();
  }, 20000);

  it('RS2：注册表可发现 battle/map 的 cmdMerges 与对外服', async () => {
    await waitUntil(async () => (await inspector.registry.listAlive()).length >= 3);
    const servers = await inspector.registry.listAlive();

    const battleRecord = servers.find((s) => s.id === battle.ready.instanceId);
    const mapRecord = servers.find((s) => s.id === map.ready.instanceId);
    const externalRecord = servers.find((s) => s.id === external.ready.instanceId);

    expect(battleRecord?.serverType).toBe('logic');
    expect(battleRecord?.tag).toBe('battle');
    expect(battleRecord?.cmdMerges).toEqual(expect.arrayContaining([101 << 16 | 1, 101 << 16 | 2]));
    expect(mapRecord?.cmdMerges).toEqual(expect.arrayContaining([201 << 16 | 1]));
    expect(externalRecord?.serverType).toBe('external');
    expect(externalRecord?.cmdMerges).toEqual([]);

    expect((await inspector.registry.findServerByCmdMerge(101 << 16 | 1))?.id).toBe(battle.ready.instanceId);
    expect((await inspector.registry.findServerByCmdMerge(201 << 16 | 1))?.id).toBe(map.ready.instanceId);
  }, 20000);

  it('RS5：逻辑服 Action 绑定的 userId 跨进程回传并登记连接', async () => {
    const client = await TestClient.connect(external.port, '1005');
    const response = await client.request(101, 3);
    expect(response.data).toEqual({ bound: '777' });

    await waitUntil(async () => (await inspector.connectionStore.lookup('777')) === external.ready.instanceId);
    expect(await inspector.connectionStore.lookup('777')).toBe(external.ready.instanceId);
    client.close();
  }, 20000);

  it('RS5：FlowContext.send 单向发送到 map（fire-and-forget）', async () => {
    const client = await TestClient.connect(external.port, '1006');
    const response = await client.request(101, 8, { ms: 10 });
    expect(response.data).toEqual({ sent: true });
    // send 不等待响应，但 map 的慢 Action 会被真实执行（无回包需求）
    client.close();
  }, 20000);
});

describe('RS3/RS4 失败路径：对端崩溃与优雅下线', () => {
  it('RS4：对端进程崩溃 → 调用方显式得到 PEER_OFFLINE(502)', async () => {
    const cluster = new Cluster('crash');
    const inspector = new Inspector();
    await inspector.start(cluster.prefix);
    await cluster.startLogic('battle', `battle-${cluster.runId}`, 1000);
    const map = await cluster.startLogic('map', `map-${cluster.runId}`, 1000);
    const external = await cluster.startExternal(`external-${cluster.runId}`);

    try {
      const client = await TestClient.connect(external.port, '2001');
      // 先确认正常
      const ok = await client.request(101, 7);
      expect(ok.data).toMatchObject({ ok: true });

      // SIGKILL 模拟崩溃（不触发 graceful unregister）
      map.child.kill('SIGKILL');
      await waitForExit(map.child, 5000);

      // 等待到「注册表仍认为存活、但 RPC 必然超时」的窗口内发起调用
      await new Promise((resolve) => setTimeout(resolve, 450));
      const failed = await client.request(101, 7);
      expect(failed.data).toMatchObject({ ok: false, code: 'PEER_OFFLINE', errorCode: 502 });

      client.close();
    } finally {
      await cluster.stopAll();
      await inspector.stop();
    }
  }, 60000);

  it('RS3：逻辑服优雅下线后 → 未注册路由显式 NOT_REGISTERED(503)', async () => {
    const cluster = new Cluster('offline');
    const inspector = new Inspector();
    await inspector.start(cluster.prefix);
    await cluster.startLogic('battle', `battle-${cluster.runId}`);
    const map = await cluster.startLogic('map', `map-${cluster.runId}`);
    const external = await cluster.startExternal(`external-${cluster.runId}`);

    try {
      const client = await TestClient.connect(external.port, '3001');
      const ok = await client.request(101, 2, {});
      expect(ok.data).toMatchObject({ fromBattle: true });

      // 优雅下线：harness 收到 SIGTERM 后 host.stop() → registry.unregisterSelf()
      await cluster.stop(map.child);
      await waitUntil(async () => !(await inspector.registry.isAlive(map.ready.instanceId)));
      // 等 battle 路由缓存失效
      await new Promise((resolve) => setTimeout(resolve, 400));

      const failed = await client.request(101, 7);
      expect(failed.data).toMatchObject({ ok: false, code: 'NOT_REGISTERED', errorCode: 503 });
      client.close();
    } finally {
      await cluster.stopAll();
      await inspector.stop();
    }
  }, 60000);
});

describe('RS8 跨进程重复路由检测', () => {
  it('第二个逻辑服承接已注册 cmdMerge 时启动期显式失败', async () => {
    const cluster = new Cluster('dup');
    await cluster.startLogic('battle', `battle-${cluster.runId}`);
    await cluster.startLogic('map', `map-${cluster.runId}`);

    const duplicate = cluster.spawnDuplicate(`dup-${cluster.runId}`);
    const code = await waitForExit(duplicate.child, 20000);
    const output = duplicate.output();

    expect(code).toBe(1);
    expect(output).toContain('STARTUP_FAILED');
    expect(output).toContain('Duplicate routes detected across processes');
    expect(output).toContain('cmd=101');

    await cluster.stopAll();
  }, 60000);
});

describe('RS4 失败路径：跨进程重复回包去重', () => {
  it('对端对同一 correlationId 回两次包时调用方只 resolve 一次并记录重复', async () => {
    const prefix = `ionet-test-double-${runId()}:`;
    const childId = `double-${runId()}`;
    const spawned = spawnHarness(DOUBLE_REPLY_HARNESS, {
      IONET_INSTANCE_ID: childId,
      IONET_KEY_PREFIX: prefix,
      IONET_REDIS_PORT: String(REDIS_PORT),
    });

    try {
      await waitForReady(spawned);

      const requesterId = `requester-${runId()}`;
      const client = new RedisClient({ instanceId: requesterId });
      await client.connect();
      const pubSub = new RedisPubSub(client);
      await pubSub.connect();
      const rpc = new RedisRequestReply(client, pubSub, {
        keyPrefix: prefix,
        instanceId: requesterId,
        defaultTimeoutMs: 3000,
      });
      await rpc.start();

      try {
        const reply = await rpc.call(childId, 'logic.action', { x: 1 });
        // 只 resolve 一次：拿到手工回包或框架正式回包之一，不因重复回包二次触发
        expect(reply).toMatchObject({ data: { source: expect.any(String) } });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(rpc.getStats().duplicateReplies).toBeGreaterThanOrEqual(1);
        expect(rpc.getStats().pending).toBe(0);
      } finally {
        await rpc.stop().catch(() => {});
        await pubSub.disconnect().catch(() => {});
        await client.disconnect().catch(() => {});
      }
    } finally {
      spawned.child.kill('SIGTERM');
      await waitForExit(spawned.child, 8000).catch(() => spawned.child.kill('SIGKILL'));
    }
  }, 30000);
});

describe('RS6 逻辑服 → 对外服反向通道', () => {
  const cluster = new Cluster('onexternal');
  let external: Harness & { port: number };

  beforeAll(async () => {
    await cluster.startLogic('battle', `battle-${cluster.runId}`);
    external = await cluster.startExternal(`external-${cluster.runId}`);
  }, 60000);

  afterAll(async () => {
    await cluster.stopAll();
  }, 30000);

  it('逻辑服推送跨进程送达另一个进程的用户连接', async () => {
    const client = await TestClient.connect(external.port, '4001');
    const response = await client.request(101, 4, { userId: '4001', text: 'frame-1' });
    expect(response.data).toEqual({ pushed: true });

    const notification = await client.waitForNotification('battle-push');
    expect(notification.data).toEqual({ text: 'frame-1' });
    expect(notification.kind).toBe('notification');
    client.close();
  }, 20000);

  it('逻辑服经 OnExternal 强制用户下线（连接被关闭）', async () => {
    const client = await TestClient.connect(external.port, '4002');
    // 强制下线会在回包前关闭连接：不断言请求响应，只断言连接被关闭。
    client.request(101, 5, { userId: '4002' }).catch(() => {});
    await client.waitForClose();
  }, 20000);

  it('connect 上下线登记到跨进程连接表', async () => {
    const inspector = new Inspector();
    await inspector.start(cluster.prefix);
    try {
      const client = await TestClient.connect(external.port, '4003');
      await waitUntil(async () => (await inspector.connectionStore.lookup('4003')) === external.ready.instanceId);
      client.close();
      await waitUntil(async () => (await inspector.connectionStore.lookup('4003')) === null);
    } finally {
      await inspector.stop();
    }
  }, 30000);

  it('实例宕机不静默丢帧：归属对外服崩溃后推送显式报错', async () => {
    // 单独起一个对外服实例并 SIGKILL（连接登记仍在，实例心跳过期），
    // 验证逻辑服侧推送会显式失败而非静默丢弃。
    // 注意：必须与 battle 共用同一 keyPrefix，否则 battle 的连接归属表看不到该连接登记。
    const dyingInspector = new Inspector();
    await dyingInspector.start(cluster.prefix);
    const dyingExternal = await cluster.startExternal(`dying-${cluster.runId}`);
    const dyingClient = await TestClient.connect(dyingExternal.port, '4004');
    void dyingClient;

    // 先确认连接登记已写入，再 SIGKILL（连接登记保留、实例心跳过期）
    await waitUntil(
      async () =>
        (await dyingInspector.connectionStore.lookup('4004')) === dyingExternal.ready.instanceId,
    );

    dyingExternal.child.kill('SIGKILL');
    await waitForExit(dyingExternal.child, 5000);
    // 等心跳超时，使注册表判定该实例下线（连接登记仍保留）
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const pusher = await TestClient.connect(external.port, '4005');
    const pushResponse = await pusher.request(101, 4, { userId: '4004', text: 'lost' });
    pusher.close();

    expect(pushResponse.data).toMatchObject({ pushed: false, code: 'CONNECTION_OWNER_OFFLINE' });
    await dyingInspector.stop();
  }, 60000);
});
