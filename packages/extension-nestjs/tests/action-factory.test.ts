import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  ActionController,
  ActionMethod,
  BarSkeleton,
  BarSkeletonBuilder,
  CmdInfo,
} from '@nbb-ionet/core-framework';
import {
  ActionFactoryBeanForNest,
  IonetModule,
  IonetFeatureModule,
  IONET_BAR_SKELETON,
} from '../src/index.js';

const DI_CMD = { cmd: 400, greet: 1, next: 2 } as const;
const FEATURE_CMD = { cmd: 401, ping: 1 } as const;

@ActionController(DI_CMD.cmd)
class DiAction {
  greeting = 'di';
  count = 0;

  @ActionMethod(DI_CMD.greet)
  greet(name: string): string {
    return `${this.greeting}: ${name}`;
  }

  @ActionMethod(DI_CMD.next)
  next(): number {
    return ++this.count;
  }
}

@ActionController(FEATURE_CMD.cmd)
class FeatureDiAction {
  @ActionMethod(FEATURE_CMD.ping)
  ping(): string {
    return 'feature-pong';
  }
}

/** 模拟 NestJS 容器：按类缓存实例，记录解析调用顺序。 */
function makeContainer() {
  const instances = new Map<Function, object>();
  const calls: Function[] = [];
  const resolve = (ActionClass: new (...args: any[]) => object): object => {
    calls.push(ActionClass);
    let instance = instances.get(ActionClass);
    if (!instance) {
      instance = new ActionClass();
      instances.set(ActionClass, instance);
    }
    return instance;
  };
  return { instances, calls, resolve };
}

const disabled = { httpServer: false, wsServer: false, redis: false } as const;

describe('IonetModule Action 工厂（任务 4）', () => {
  it('resolveAction 在 onModuleInit 被调用，Action 使用容器实例', async () => {
    const container = makeContainer();
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRoot({
          actions: [DiAction],
          resolveAction: container.resolve,
          ...disabled,
        }),
      ],
    }).compile();

    const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);
    // 延迟到 onModuleInit：compile 阶段不调用工厂，骨架暂无路由
    expect(container.calls).toHaveLength(0);

    await moduleRef.init();
    expect(container.calls).toEqual([DiAction]);

    const command = skeleton.actionCommandRegions.getActionCommand(CmdInfo.of(DI_CMD.cmd, DI_CMD.greet));
    expect(command?.actionController).toBe(container.instances.get(DiAction));

    const res = await skeleton.execute({ cmd: DI_CMD.cmd, subCmd: DI_CMD.greet, data: 'World' });
    expect(res.data).toBe('di: World');

    await moduleRef.close();
  });

  it('容器实例被复用（同一对象处理多次执行）', async () => {
    const container = makeContainer();
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRoot({
          actions: [DiAction],
          resolveAction: container.resolve,
          ...disabled,
        }),
      ],
    }).compile();
    await moduleRef.init();

    const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);
    const first = await skeleton.execute({ cmd: DI_CMD.cmd, subCmd: DI_CMD.next });
    const second = await skeleton.execute({ cmd: DI_CMD.cmd, subCmd: DI_CMD.next });

    expect(first.data).toBe(1);
    expect(second.data).toBe(2);
    expect(container.calls).toEqual([DiAction]);

    await moduleRef.close();
  });

  it('每个 Action 类只解析一次，两个方法共用同一实例', async () => {
    const container = makeContainer();
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRoot({
          actions: [DiAction, FeatureDiAction],
          resolveAction: container.resolve,
          ...disabled,
        }),
      ],
    }).compile();
    await moduleRef.init();

    const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);
    expect(container.calls).toEqual([DiAction, FeatureDiAction]);

    const greet = skeleton.actionCommandRegions.getActionCommand(CmdInfo.of(DI_CMD.cmd, DI_CMD.greet));
    const next = skeleton.actionCommandRegions.getActionCommand(CmdInfo.of(DI_CMD.cmd, DI_CMD.next));
    expect(greet?.actionController).toBe(next?.actionController);
    expect(greet?.actionController).toBe(container.instances.get(DiAction));

    const controllers = skeleton.actionCommandRegions.getAllActionCommands().map((c) => c.actionController);
    expect(new Set(controllers).size).toBe(2);

    await moduleRef.close();
  });

  it('actionFactory（ActionFactoryBean）直接可用', async () => {
    const container = makeContainer();
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRoot({
          actions: [DiAction],
          actionFactory: { getBean: (Cls) => container.resolve(Cls) },
          ...disabled,
        }),
      ],
    }).compile();
    await moduleRef.init();

    const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);
    expect(container.calls).toEqual([DiAction]);
    const res = await skeleton.execute({ cmd: DI_CMD.cmd, subCmd: DI_CMD.greet, data: 'A' });
    expect(res.data).toBe('di: A');

    await moduleRef.close();
  });

  it('未配置工厂：回退 new，compile 后即可执行（既有行为不变）', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IonetModule.forRoot({ actions: [DiAction], ...disabled })],
    }).compile();

    const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);
    expect(skeleton.hasActionFactory()).toBe(false);
    expect(skeleton.actionCommandRegions.getActionCommand(CmdInfo.of(DI_CMD.cmd, DI_CMD.greet))).toBeDefined();

    const res = await skeleton.execute({ cmd: DI_CMD.cmd, subCmd: DI_CMD.greet, data: 'X' });
    expect(res.data).toBe('di: X');

    await moduleRef.close();
  });

  it('与 forFeature 组合：forRoot 先、forFeature 后解析注册', async () => {
    const container = makeContainer();
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonetModule.forRoot({
          actions: [DiAction],
          resolveAction: container.resolve,
          ...disabled,
        }),
        IonetFeatureModule.forFeature({ actions: [FeatureDiAction] }),
      ],
    }).compile();
    await moduleRef.init();

    expect(container.calls).toEqual([DiAction, FeatureDiAction]);

    const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);
    expect((await skeleton.execute({ cmd: DI_CMD.cmd, subCmd: DI_CMD.greet, data: 'A' })).data).toBe('di: A');
    expect((await skeleton.execute({ cmd: FEATURE_CMD.cmd, subCmd: FEATURE_CMD.ping })).data).toBe('feature-pong');

    await moduleRef.close();
  });
});

describe('ActionFactoryBeanForNest（任务 4）', () => {
  it('未显式 instance 时经工厂解析；工厂返回 undefined 回退 new', () => {
    const instance = new DiAction();
    const factory = new ActionFactoryBeanForNest((Cls) => (Cls === DiAction ? instance : undefined));

    const skeleton = new BarSkeletonBuilder()
      .setActionFactory(factory)
      .addAction(DiAction)
      .addAction(FeatureDiAction)
      .build();

    expect(skeleton.hasActionFactory()).toBe(true);
    const diCommand = skeleton.actionCommandRegions.getActionCommand(CmdInfo.of(DI_CMD.cmd, DI_CMD.greet));
    expect(diCommand?.actionController).toBe(instance);
    // 工厂返回 undefined -> 回退 new
    const featureCommand = skeleton.actionCommandRegions.getActionCommand(CmdInfo.of(FEATURE_CMD.cmd, FEATURE_CMD.ping));
    expect(featureCommand?.actionController).toBeInstanceOf(FeatureDiAction);
  });
});
