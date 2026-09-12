import { Module, DynamicModule, Provider, OnModuleInit, OnModuleDestroy, Inject, Global, Optional } from '@nestjs/common';
import { type Server } from 'node:http';
import {
  BarSkeleton,
  BarSkeletonBuilder,
  createMemoryBroadcaster,
  type ActionFactoryBean,
} from '@nbb-ionet/core-framework';
import { HttpExternalServer, WebSocketExternalServer } from '@nbb-ionet/external-server';
import { ActionFactoryBeanForNest } from './action-factory-bean-for-nest.js';
import { RedisClient } from '@nbb-ionet/redis';
import {
  IONET_MODULE_OPTIONS,
  IONET_BAR_SKELETON,
  IONET_HTTP_SERVER,
  IONET_WS_SERVER,
  IONET_REDIS_CLIENT,
  IONET_ACTIONS,
  IONET_FEATURE_ACTIONS,
  IONET_BROADCASTER,
} from './ionet.constants.js';
import type {
  IonetModuleOptions,
  IonetModuleAsyncOptions,
  IonetFeatureOptions,
} from './ionet.interfaces.js';

/**
 * 由 options 构造 Action 实例工厂（任务 4）。两者都未配置时返回 undefined，
 * 骨架按既有行为直接 new ActionClass()。
 */
function resolveActionFactory(options: IonetModuleOptions): ActionFactoryBean | undefined {
  if (options.actionFactory) return options.actionFactory;
  if (options.resolveAction) return new ActionFactoryBeanForNest(options.resolveAction);
  return undefined;
}

/**
 * 构造 Broadcaster provider（任务 1 / P0-5）。
 *
 * 数据源：WebSocketExternalServer 的连接注册表适配器（connectionRegistry），
 * 使 MemoryBroadcaster 真正能看到在线连接；wsServer 未启用时退化为空注册表
 * （推送为安全 no-op，返回不抛错）。
 *
 * 默认提供；options.broadcaster === false 时返回 null。
 */
function createBroadcasterProvider(): Provider {
  return {
    provide: IONET_BROADCASTER,
    useFactory: (wsServer: WebSocketExternalServer | null, opts: IonetModuleOptions) => {
      if (opts.broadcaster === false) {
        return null;
      }
      const connections = wsServer?.connectionRegistry;
      return createMemoryBroadcaster(connections ? { connections } : {}).broadcaster;
    },
    inject: [IONET_WS_SERVER, IONET_MODULE_OPTIONS],
  };
}

function assertNotProduction(allowProduction: boolean | undefined): void {
  if (allowProduction === true) return;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[@nbb-ionet/extension-nestjs] 此模块仅允许在开发/调试模式下使用，禁止在生产环境运行。' +
      '生产环境请使用 Java External Server（TCP/WebSocket）。' +
      '如确需在非标准环境启动，请移除 NODE_ENV=production 设置。',
    );
  }
}

@Global()
@Module({})
export class IonetModule implements OnModuleInit, OnModuleDestroy {
  private readonly skeleton: BarSkeleton | null;
  private readonly httpServer: HttpExternalServer | null;
  private readonly wsServer: WebSocketExternalServer | null;
  private readonly redisClient: RedisClient | null;
  private readonly moduleOptions: IonetModuleOptions;
  // attach 模式共享的 NestJS http.Server，由应用侧经 attachHttpServer() 在 app.init() 之前推送
  private attachedHttpServer: Server | null;

  constructor(
    @Inject(IONET_BAR_SKELETON) skeleton: BarSkeleton | null,
    @Inject(IONET_HTTP_SERVER) httpServer: HttpExternalServer | null,
    @Inject(IONET_WS_SERVER) wsServer: WebSocketExternalServer | null,
    @Inject(IONET_REDIS_CLIENT) redisClient: RedisClient | null,
    @Inject(IONET_MODULE_OPTIONS) moduleOptions: IonetModuleOptions,
  ) {
    this.skeleton = skeleton;
    this.httpServer = httpServer;
    this.wsServer = wsServer;
    this.redisClient = redisClient;
    this.moduleOptions = moduleOptions;
    this.attachedHttpServer = null;
  }

  /**
   * 预先提供 NestJS 应用的 http.Server（attach 模式接线入口）。
   *
   * 应用侧须在 app.init()（触发 onModuleInit）之前调用，典型写法：
   * `app.get(IonetModule).attachHttpServer(app.getHttpServer())`。
   *
   * 为什么由应用侧推送、而非模块侧注入 HttpAdapterHost 自取：
   * 跨仓库 pnpm workspace 链接（应用仓库经 workspace:* 引入本框架仓库的包）下，
   * 应用侧与框架侧各自解析到物理上独立的一份 @nestjs/core，类令牌（HttpAdapterHost）
   * 无法跨副本统一，注入会静默降级为 undefined（已实证）。http.Server 是 node 内置
   * 对象、IonetModule 类来自同一 workspace 符号链接副本，二者身份安全，故取推送式接线。
   */
  attachHttpServer(server: Server): void {
    this.attachedHttpServer = server;
  }

  static forRoot(options: IonetModuleOptions): DynamicModule {
    assertNotProduction(options.allowProduction);

    const optionsProvider: Provider = {
      provide: IONET_MODULE_OPTIONS,
      useValue: options,
    };

    const actionsProvider: Provider = {
      provide: IONET_ACTIONS,
      useValue: options.actions ?? [],
    };

    const skeletonProvider: Provider = {
      provide: IONET_BAR_SKELETON,
      useFactory: (actionClasses: Function[]) => {
        const builder = new BarSkeletonBuilder();
        const actionFactory = resolveActionFactory(options);
        if (actionFactory) {
          // 配置了工厂：实例解析延迟到 onModuleInit（app 就绪后），此处只挂工厂。
          builder.setActionFactory(actionFactory);
        } else {
          for (const ActionClass of actionClasses) {
            builder.addAction(ActionClass);
          }
        }
        if (options.inOuts) {
          for (const inOut of options.inOuts) {
            builder.addInOut(inOut);
          }
        }
        if (options.setting) {
          builder.setSetting(options.setting);
        }
        return builder.build();
      },
      inject: [IONET_ACTIONS],
    };

    const httpServerProvider: Provider = {
      provide: IONET_HTTP_SERVER,
      useFactory: (opts: IonetModuleOptions) => {
        if (opts.httpServer === false || !opts.httpServer) {
          return null;
        }
        const { enabled, ...serverOpts } = opts.httpServer;
        if (enabled === false) {
          return null;
        }
        // pathPrefix 等 HttpExternalServerOptions 字段随 ...serverOpts 透传（P2-2）
        return new HttpExternalServer(serverOpts);
      },
      inject: [IONET_MODULE_OPTIONS],
    };

    const wsServerProvider: Provider = {
      provide: IONET_WS_SERVER,
      useFactory: (opts: IonetModuleOptions) => {
        if (opts.wsServer === false || !opts.wsServer) {
          return null;
        }
        // attachNestServer 是模块级接线指令（见 onModuleInit），不透传给传输层
        const { enabled, attachNestServer: _attachNestServer, ...serverOpts } = opts.wsServer;
        if (enabled === false) {
          return null;
        }
        return new WebSocketExternalServer(serverOpts);
      },
      inject: [IONET_MODULE_OPTIONS],
    };

    const redisProvider: Provider = {
      provide: IONET_REDIS_CLIENT,
      useFactory: (opts: IonetModuleOptions) => {
        if (opts.redis === false || !opts.redis) {
          return null;
        }
        return new RedisClient(opts.redis);
      },
      inject: [IONET_MODULE_OPTIONS],
    };

    return {
      module: IonetModule,
      providers: [
        optionsProvider,
        actionsProvider,
        skeletonProvider,
        httpServerProvider,
        wsServerProvider,
        redisProvider,
        createBroadcasterProvider(),
      ],
      exports: [
        IONET_BAR_SKELETON,
        IONET_HTTP_SERVER,
        IONET_WS_SERVER,
        IONET_REDIS_CLIENT,
        IONET_BROADCASTER,
      ],
    };
  }

  static forRootAsync(options: IonetModuleAsyncOptions): DynamicModule {
    // 异步选项在模块定义期尚不可得，生产守卫延后到 onModuleInit（见下）

    const asyncOptionsProvider: Provider = {
      provide: IONET_MODULE_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };

    const actionsProvider: Provider = {
      provide: IONET_ACTIONS,
      useFactory: (opts: IonetModuleOptions) => opts.actions ?? [],
      inject: [IONET_MODULE_OPTIONS],
    };

    const skeletonProvider: Provider = {
      provide: IONET_BAR_SKELETON,
      useFactory: (opts: IonetModuleOptions, actionClasses: Function[]) => {
        const builder = new BarSkeletonBuilder();
        const actionFactory = resolveActionFactory(opts);
        if (actionFactory) {
          // 配置了工厂：实例解析延迟到 onModuleInit（app 就绪后），此处只挂工厂。
          builder.setActionFactory(actionFactory);
        } else {
          for (const ActionClass of actionClasses) {
            builder.addAction(ActionClass);
          }
        }
        if (opts.inOuts) {
          for (const inOut of opts.inOuts) {
            builder.addInOut(inOut);
          }
        }
        if (opts.setting) {
          builder.setSetting(opts.setting);
        }
        return builder.build();
      },
      inject: [IONET_MODULE_OPTIONS, IONET_ACTIONS],
    };

    const httpServerProvider: Provider = {
      provide: IONET_HTTP_SERVER,
      useFactory: (opts: IonetModuleOptions) => {
        if (opts.httpServer === false || !opts.httpServer) {
          return null;
        }
        const { enabled, ...serverOpts } = opts.httpServer;
        if (enabled === false) {
          return null;
        }
        // pathPrefix 等 HttpExternalServerOptions 字段随 ...serverOpts 透传（P2-2）
        return new HttpExternalServer(serverOpts);
      },
      inject: [IONET_MODULE_OPTIONS],
    };

    const wsServerProvider: Provider = {
      provide: IONET_WS_SERVER,
      useFactory: (opts: IonetModuleOptions) => {
        if (opts.wsServer === false || !opts.wsServer) {
          return null;
        }
        // attachNestServer 是模块级接线指令（见 onModuleInit），不透传给传输层
        const { enabled, attachNestServer: _attachNestServer, ...serverOpts } = opts.wsServer;
        if (enabled === false) {
          return null;
        }
        return new WebSocketExternalServer(serverOpts);
      },
      inject: [IONET_MODULE_OPTIONS],
    };

    const redisProvider: Provider = {
      provide: IONET_REDIS_CLIENT,
      useFactory: (opts: IonetModuleOptions) => {
        if (opts.redis === false || !opts.redis) {
          return null;
        }
        return new RedisClient(opts.redis);
      },
      inject: [IONET_MODULE_OPTIONS],
    };

    return {
      module: IonetModule,
      imports: options.imports ?? [],
      providers: [
        asyncOptionsProvider,
        actionsProvider,
        skeletonProvider,
        httpServerProvider,
        wsServerProvider,
        redisProvider,
        createBroadcasterProvider(),
      ],
      exports: [
        IONET_BAR_SKELETON,
        IONET_HTTP_SERVER,
        IONET_WS_SERVER,
        IONET_REDIS_CLIENT,
        IONET_BROADCASTER,
      ],
    };
  }

  async onModuleInit(): Promise<void> {
    assertNotProduction(this.moduleOptions.allowProduction);

    // 任务 4：配置了 actionFactory/resolveAction 时，Action 实例解析延迟到此处
    // （app 已创建、所有 provider 就绪），再注册进骨架。
    this.registerDeferredActions();

    if (this.redisClient) {
      await this.redisClient.connect();
    }

    if (this.httpServer && this.skeleton) {
      await this.httpServer.start(this.skeleton);
    }

    if (this.wsServer && this.skeleton) {
      let attachServer: Server | undefined;
      const wsOpts = this.moduleOptions.wsServer;
      if (wsOpts && wsOpts.attachNestServer === true) {
        // attach 模式的 http.Server 由应用侧经 attachHttpServer() 推送（见该方法注释：
        // 跨仓库 workspace 链接下 HttpAdapterHost 类令牌注入不可用，故不在此处自取）。
        const server = this.attachedHttpServer;
        if (!server) {
          throw new Error(
            '[@nbb-ionet/extension-nestjs] attachNestServer: true 需要共享的 NestJS http.Server，' +
              '请在 app.init()/app.listen() 之前调用 app.get(IonetModule).attachHttpServer(app.getHttpServer())',
          );
        }
        attachServer = server;
      }
      await this.wsServer.start(this.skeleton, attachServer);
    }
  }

  private registerDeferredActions(): void {
    if (!this.skeleton || !this.skeleton.hasActionFactory()) return;
    for (const ActionClass of this.moduleOptions.actions ?? []) {
      this.skeleton.addAction(ActionClass);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.httpServer) {
      await this.httpServer.stop();
    }

    if (this.wsServer) {
      await this.wsServer.stop();
    }

    if (this.redisClient) {
      await this.redisClient.disconnect();
    }
  }
}

@Module({})
export class IonetFeatureModule implements OnModuleInit {
  private readonly skeleton: BarSkeleton | null;
  private readonly actions: Array<new (...args: any[]) => any>;

  /**
   * 模块实例化（容器初始化阶段，早于所有 onModuleInit）时，
   * 将 forFeature 声明的 actions 注册进 forRoot 构建的共享 BarSkeleton 路由表。
   *
   * 未配置 Action 工厂时在此同步注册（既有行为）；配置了工厂时延迟到 onModuleInit，
   * 以便在容器就绪后从 DI 解析实例（任务 4）。
   */
  constructor(
    @Optional() @Inject(IONET_BAR_SKELETON) skeleton: BarSkeleton | null,
    @Inject(IONET_FEATURE_ACTIONS) actions: Array<new (...args: any[]) => any>,
  ) {
    if (!skeleton) {
      throw new Error(
        '[@nbb-ionet/extension-nestjs] IonetFeatureModule.forFeature() 必须与 IonetModule.forRoot()/forRootAsync() 一起使用：' +
        '未找到 BarSkeleton（IONET_BAR_SKELETON），无法注册 feature actions。',
      );
    }
    this.skeleton = skeleton;
    this.actions = actions;
    if (!skeleton.hasActionFactory()) {
      for (const ActionClass of actions) {
        skeleton.addAction(ActionClass);
      }
    }
  }

  /** 配置了 Action 工厂：容器就绪后解析实例并注册（与 forRoot 的延迟注册一致）。 */
  onModuleInit(): void {
    if (this.skeleton?.hasActionFactory()) {
      for (const ActionClass of this.actions) {
        this.skeleton.addAction(ActionClass);
      }
    }
  }

  static forFeature(options: IonetFeatureOptions): DynamicModule {

    const actionsProvider: Provider = {
      provide: IONET_FEATURE_ACTIONS,
      useValue: options.actions,
    };

    return {
      module: IonetFeatureModule,
      providers: [actionsProvider],
    };
  }
}
