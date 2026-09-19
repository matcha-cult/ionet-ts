import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ActionController, ActionMethod } from './decorators/action-decorators.js';
import { BarSkeletonBuilder } from './core/bar-skeleton.js';
import { CmdInfo } from './core/cmd-info.js';
import { FlowContext } from './core/flow/flow-context.js';
import {
  CommunicationKit,
  CrossServerError,
  type CrossServerCallContext,
  type CrossServerResponse,
  type CrossServerRouter,
} from './core/communication/index.js';
import { ActionCommandRegionGlobalCheckKit } from './core/kit/global-check.js';

const CMD = { cmd: 100, echo: 1, login: 2 } as const;

@ActionController(CMD.cmd)
class RemoteAction {
  @ActionMethod(CMD.echo)
  echo(data: unknown): unknown {
    return data;
  }

  @ActionMethod(CMD.login)
  login(): string {
    return 'local';
  }
}

interface ForwardCall {
  cmdInfo: CmdInfo;
  data: unknown;
  context: CrossServerCallContext;
}

class FakeRouter implements CrossServerRouter {
  readonly forwards: ForwardCall[] = [];
  readonly sends: ForwardCall[] = [];
  behavior: 'ok' | 'not-registered' | 'timeout' = 'ok';

  async forward(
    cmdInfo: CmdInfo,
    data: unknown,
    context: CrossServerCallContext,
  ): Promise<CrossServerResponse> {
    this.forwards.push({ cmdInfo, data, context });
    if (this.behavior === 'not-registered') {
      throw CrossServerError.notRegistered(cmdInfo.cmdMerge);
    }
    if (this.behavior === 'timeout') {
      throw CrossServerError.timeout({ id: 'logic-1', cmdMerge: cmdInfo.cmdMerge }, 50);
    }
    return { data: { remote: data }, userId: '999' };
  }

  async forwardSend(
    cmdInfo: CmdInfo,
    data: unknown,
    context: CrossServerCallContext,
  ): Promise<void> {
    if (this.behavior === 'not-registered') {
      throw CrossServerError.notRegistered(cmdInfo.cmdMerge);
    }
    this.sends.push({ cmdInfo, data, context });
  }
}

describe('CrossServerError', () => {
  it('maps codes to response errorCode', () => {
    expect(CrossServerError.notRegistered(7).errorCode).toBe(503);
    expect(CrossServerError.peerOffline({ id: 'x' }).errorCode).toBe(502);
    expect(CrossServerError.timeout({ id: 'x' }, 10).errorCode).toBe(504);
    expect(CrossServerError.notConfigured().errorCode).toBe(500);
  });

  it('carries explicit code and message', () => {
    const error = CrossServerError.notRegistered(12345);
    expect(error.code).toBe('NOT_REGISTERED');
    expect(error.message).toContain('cmdMerge=12345');
  });
});

describe('FlowContext cross-server API', () => {
  let router: FakeRouter;
  let ctx: FlowContext;

  beforeEach(() => {
    router = new FakeRouter();
    CommunicationKit.setCrossServerRouter(router);
    ctx = new FlowContext();
    ctx.setCmdInfo(CmdInfo.of(CMD.cmd, CMD.echo));
    ctx.setRequest({ cmd: CMD.cmd, subCmd: CMD.echo, traceId: 'trace-1', headers: { a: 'b' } });
    ctx.bindingUserId(42n);
  });

  afterEach(() => {
    CommunicationKit.clear();
  });

  it('call (cmd, subCmd) forwards with caller identity', async () => {
    const response = await ctx.call(CMD.cmd, CMD.echo, 'hello');
    expect(response.data).toEqual({ remote: 'hello' });
    expect(router.forwards).toHaveLength(1);
    expect(router.forwards[0].cmdInfo.cmdMerge).toBe(CmdInfo.of(CMD.cmd, CMD.echo).cmdMerge);
    expect(router.forwards[0].context.userId).toBe('42');
    expect(router.forwards[0].context.traceId).toBe('trace-1');
    expect(router.forwards[0].context.headers).toEqual({ a: 'b' });
  });

  it('call accepts CmdInfo form', async () => {
    await ctx.call(CmdInfo.of(CMD.cmd, CMD.echo), 'x');
    expect(router.forwards).toHaveLength(1);
  });

  it('call rejects with CrossServerError on failure', async () => {
    router.behavior = 'not-registered';
    await expect(ctx.call(CMD.cmd, 77)).rejects.toMatchObject({ code: 'NOT_REGISTERED' });
  });

  it('callAsync never rejects; returns error envelope', async () => {
    router.behavior = 'timeout';
    const response = await ctx.callAsync(CMD.cmd, CMD.echo);
    expect(response.errorCode).toBe(504);
    expect(response.errorMessage).toContain('timeout');
  });

  it('send is fire-and-forget via forwardSend', async () => {
    ctx.send(CMD.cmd, CMD.echo, 'event');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.sends).toHaveLength(1);
    expect(router.sends[0].data).toBe('event');
  });

  it('sendAsync surfaces failure to caller', async () => {
    router.behavior = 'not-registered';
    await expect(ctx.sendAsync(CMD.cmd, CMD.echo)).rejects.toMatchObject({
      code: 'NOT_REGISTERED',
    });
  });

  it('throws NOT_CONFIGURED when no router registered', async () => {
    CommunicationKit.clear();
    await expect(ctx.call(CMD.cmd, CMD.echo)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});

describe('BarSkeleton distributed routing fallback', () => {
  let router: FakeRouter;

  afterEach(() => {
    CommunicationKit.clear();
  });

  it('keeps local 404 when no cross-server router configured', async () => {
    const skeleton = new BarSkeletonBuilder().addAction(RemoteAction).build();
    const response = await skeleton.execute({ cmd: 999, subCmd: 1 });
    expect(response.errorCode).toBe(404);
  });

  it('forwards local miss to router and reports bound userId', async () => {
    const skeleton = new BarSkeletonBuilder().addAction(RemoteAction).build();
    router = new FakeRouter();
    skeleton.setCrossServerRouter(router);

    const bound: bigint[] = [];
    const response = await skeleton.execute(
      { cmd: 555, subCmd: 1, data: 'payload', traceId: 't9' },
      { onBound: (userId) => bound.push(userId) },
    );

    expect(response.errorCode).toBeUndefined();
    expect(response.data).toEqual({ remote: 'payload' });
    expect(router.forwards).toHaveLength(1);
    expect(router.forwards[0].cmdInfo.cmdMerge).toBe(CmdInfo.of(555, 1).cmdMerge);
    // 逻辑服回传的 userId=999 触发对外服 onBound（登录跨进程绑定）
    expect(bound).toEqual([999n]);
  });

  it('maps unregistered route to explicit 503, not silent 404', async () => {
    const skeleton = new BarSkeletonBuilder().addAction(RemoteAction).build();
    router = new FakeRouter();
    router.behavior = 'not-registered';
    skeleton.setCrossServerRouter(router);

    const response = await skeleton.execute({ cmd: 777, subCmd: 7 });
    expect(response.errorCode).toBe(503);
    expect(response.errorMessage).toContain('No logic server registered');
  });

  it('executes local action without invoking router', async () => {
    const skeleton = new BarSkeletonBuilder().addAction(RemoteAction).build();
    router = new FakeRouter();
    skeleton.setCrossServerRouter(router);
    const response = await skeleton.execute({ cmd: CMD.cmd, subCmd: CMD.echo, data: 1 });
    expect(response.data).toBe(1);
    expect(router.forwards).toHaveLength(0);
  });
});

describe('ActionCommandRegionGlobalCheckKit cmdMerge regions (RS8)', () => {
  it('detects duplicate cmdMerge across registry labels', () => {
    const duplicates = ActionCommandRegionGlobalCheckKit.detectGlobalDuplicateCmdMerges([
      { label: 'battle(s1)', cmdMerges: [CmdInfo.of(1, 1).cmdMerge, CmdInfo.of(1, 2).cmdMerge] },
      { label: 'map(s2)', cmdMerges: [CmdInfo.of(1, 2).cmdMerge, CmdInfo.of(2, 1).cmdMerge] },
    ]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ cmd: 1, subCmd: 2 });
    expect(duplicates[0].regions).toEqual(['battle(s1)', 'map(s2)']);
  });

  it('assert throws with actionable details', () => {
    expect(() =>
      ActionCommandRegionGlobalCheckKit.assertNoDuplicateCmdMerges([
        { label: 'a', cmdMerges: [5] },
        { label: 'b', cmdMerges: [5] },
      ]),
    ).toThrow(/Duplicate routes detected across processes/);
  });
});
