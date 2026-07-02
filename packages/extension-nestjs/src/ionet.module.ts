import { Module, DynamicModule, Provider, OnModuleInit, OnModuleDestroy, Inject, Global } from '@nestjs/common';
import { BarSkeleton, BarSkeletonBuilder } from '@nbb-ionet/core-framework';
import { HttpExternalServer, WebSocketExternalServer } from '@nbb-ionet/external-server';
import { RedisClient } from '@nbb-ionet/redis';
import {
  IONET_MODULE_OPTIONS,
  IONET_BAR_SKELETON,
  IONET_HTTP_SERVER,
  IONET_WS_SERVER,
  IONET_REDIS_CLIENT,
  IONET_ACTIONS,
} from './ionet.constants.js';
import type {
  IonetModuleOptions,
  IonetModuleAsyncOptions,
  IonetFeatureOptions,
} from './ionet.interfaces.js';

@Global()
@Module({})
export class IonetModule implements OnModuleInit, OnModuleDestroy {
  private readonly skeleton: BarSkeleton | null;
  private readonly httpServer: HttpExternalServer | null;
  private readonly wsServer: WebSocketExternalServer | null;
  private readonly redisClient: RedisClient | null;

  constructor(
    @Inject(IONET_BAR_SKELETON) skeleton: BarSkeleton | null,
    @Inject(IONET_HTTP_SERVER) httpServer: HttpExternalServer | null,
    @Inject(IONET_WS_SERVER) wsServer: WebSocketExternalServer | null,
    @Inject(IONET_REDIS_CLIENT) redisClient: RedisClient | null,
  ) {
    this.skeleton = skeleton;
    this.httpServer = httpServer;
    this.wsServer = wsServer;
    this.redisClient = redisClient;
  }

  static forRoot(options: IonetModuleOptions): DynamicModule {
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
        for (const ActionClass of actionClasses) {
          builder.addAction(ActionClass);
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
        const { enabled, ...serverOpts } = opts.wsServer;
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
      ],
      exports: [
        IONET_BAR_SKELETON,
        IONET_HTTP_SERVER,
        IONET_WS_SERVER,
        IONET_REDIS_CLIENT,
      ],
    };
  }

  static forRootAsync(options: IonetModuleAsyncOptions): DynamicModule {
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
        for (const ActionClass of actionClasses) {
          builder.addAction(ActionClass);
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
        const { enabled, ...serverOpts } = opts.wsServer;
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
      ],
      exports: [
        IONET_BAR_SKELETON,
        IONET_HTTP_SERVER,
        IONET_WS_SERVER,
        IONET_REDIS_CLIENT,
      ],
    };
  }

  async onModuleInit(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.connect();
    }

    if (this.httpServer && this.skeleton) {
      await this.httpServer.start(this.skeleton);
    }

    if (this.wsServer && this.skeleton) {
      await this.wsServer.start(this.skeleton);
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
export class IonetFeatureModule {
  static forFeature(options: IonetFeatureOptions): DynamicModule {
    const actionsProvider: Provider = {
      provide: IONET_ACTIONS,
      useValue: options.actions,
    };

    return {
      module: IonetFeatureModule,
      providers: [actionsProvider],
      exports: [IONET_ACTIONS],
    };
  }
}
