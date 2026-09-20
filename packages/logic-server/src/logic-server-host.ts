import {
  BarSkeleton,
  BarSkeletonBuilder,
  CommunicationKit,
  createMemoryBroadcaster,
  type ServerInfo,
} from '@nbb-ionet/core-framework';
import {
  ConnectionRegistryStore,
  DistributedBroadcasterDecorator,
  RedisOnExternalTransport,
  RedisRequestReply,
  ServerRegistry,
  type RedisClient,
  type RedisPubSub,
  type ServerRecord,
} from '@nbb-ionet/redis';
import type { LogicServer } from './logic-server.js';
import { ServerBuilder } from './server-builder.js';
import { RedisLogicRouter } from './redis-logic-router.js';
import { ExternalCommunication } from './external-communication.js';
import { assertNoCrossProcessDuplicateRoutes } from './cross-process-duplicate-check.js';
import {
  RPC_HANDLER_ACTION,
  type LogicActionReplyPayload,
  type LogicActionRequestPayload,
} from './protocol.js';

export interface LogicServerHostOptions {
  /** 消费方模块的 LogicServer 实现（只做 builder 配置，不写业务）。 */
  logicServer: LogicServer;
  redisClient: RedisClient;
  pubSub: RedisPubSub;
  keyPrefix?: string;
  /** 实例 id；缺省用 redisClient.getInstanceId()。 */
  instanceId?: string;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  defaultCallTimeoutMs?: number;
  /** 启动期跨进程重复路由检测（RS8）；缺省开启。 */
  checkDuplicateRoutes?: boolean;
}

/**
 * RS1 —— 逻辑服宿主。
 *
 * 启动一个「只注册 Action、不监听客户端端口」的逻辑服进程：
 * 1. 由 `LogicServer` 配置并构建 `BarSkeleton`（Action 路由表）与元数据；
 * 2. 注册进 Redis 注册表（RS2），可选做跨进程重复路由检测（RS8）；
 * 3. 订阅本实例 RPC 通道并注册 action handler（RS4）；
 * 4. 安装 `RedisLogicRouter` 到 `CommunicationKit`，使 `FlowContext.call/send` 可用（RS3/RS5）；
 * 5. 提供 `ExternalCommunication`（RS6）。
 */
export class LogicServerHost {
  readonly skeleton: BarSkeleton;
  readonly serverRecord: ServerRecord;
  readonly serverInfo: ServerInfo;
  readonly registry: ServerRegistry;
  readonly rpc: RedisRequestReply;
  readonly router: RedisLogicRouter;
  readonly connectionStore: ConnectionRegistryStore;
  readonly externalCommunication: ExternalCommunication;
  /** RS6：逻辑服侧广播器（跨进程定向推送；本地无连接，全部走连接归属表）。 */
  readonly broadcaster: DistributedBroadcasterDecorator;
  private stopped = false;

  private constructor(
    skeleton: BarSkeleton,
    serverRecord: ServerRecord,
    registry: ServerRegistry,
    rpc: RedisRequestReply,
    router: RedisLogicRouter,
    connectionStore: ConnectionRegistryStore,
    externalCommunication: ExternalCommunication,
    broadcaster: DistributedBroadcasterDecorator,
  ) {
    this.skeleton = skeleton;
    this.serverRecord = serverRecord;
    this.serverInfo = {
      id: serverRecord.id,
      type: 'logic',
      port: serverRecord.port ?? -1,
      host: serverRecord.ip ?? '127.0.0.1',
      name: serverRecord.name,
      tag: serverRecord.tag,
    };
    this.registry = registry;
    this.rpc = rpc;
    this.router = router;
    this.connectionStore = connectionStore;
    this.externalCommunication = externalCommunication;
    this.broadcaster = broadcaster;
  }

  static async start(options: LogicServerHostOptions): Promise<LogicServerHost> {
    const { redisClient, pubSub, logicServer } = options;

    const skeletonBuilder = new BarSkeletonBuilder();
    logicServer.settingBarSkeletonBuilder(skeletonBuilder);
    const skeleton = skeletonBuilder.build();

    const serverBuilder = new ServerBuilder();
    logicServer.settingServerBuilder(serverBuilder);
    serverBuilder.setBarSkeleton(skeleton);
    serverBuilder.setServerType('logic');
    serverBuilder.setId(options.instanceId ?? redisClient.getInstanceId());

    const registry = new ServerRegistry(redisClient, pubSub, {
      keyPrefix: options.keyPrefix,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs,
    });
    await registry.start();
    const record = await registry.register(serverBuilder.build());

    if (options.checkDuplicateRoutes !== false) {
      try {
        await assertNoCrossProcessDuplicateRoutes(registry);
      } catch (error) {
        await registry.stop();
        throw error;
      }
    }

    const rpc = new RedisRequestReply(redisClient, pubSub, {
      keyPrefix: options.keyPrefix,
      instanceId: record.id,
      defaultTimeoutMs: options.defaultCallTimeoutMs,
    });
    await rpc.start();

    const router = new RedisLogicRouter(registry, rpc, {
      selfInstanceId: record.id,
      defaultTimeoutMs: options.defaultCallTimeoutMs,
    });
    CommunicationKit.setCrossServerRouter(router);

    const connectionStore = new ConnectionRegistryStore(redisClient, {
      keyPrefix: options.keyPrefix,
    });
    const transport = new RedisOnExternalTransport(redisClient, pubSub, null, {
      keyPrefix: options.keyPrefix,
      instanceId: record.id,
    });
    const externalCommunication = new ExternalCommunication(
      registry,
      connectionStore,
      transport,
      rpc,
      record.id,
      options.defaultCallTimeoutMs ?? 5000,
    );

    // RS6：逻辑服本身不持有连接，广播器只经连接归属表把定向推送投给对外服实例。
    const { broadcaster: localBroadcaster, connections, rooms } = createMemoryBroadcaster();
    const broadcaster = new DistributedBroadcasterDecorator(
      localBroadcaster,
      pubSub,
      connections,
      rooms,
      {
        instanceId: record.id,
        connectionStore,
        isInstanceAlive: (id) => registry.isAlive(id),
      },
    );
    await broadcaster.start();

    const host = new LogicServerHost(
      skeleton,
      record,
      registry,
      rpc,
      router,
      connectionStore,
      externalCommunication,
      broadcaster,
    );

    rpc.registerHandler(RPC_HANDLER_ACTION, (payload) => host.executeLocal(payload));

    logicServer.startupSuccess?.(skeleton);

    return host;
  }

  /**
   * 在本地骨架执行一次跨服 Action 请求（RPC handler）。
   * 设置 ctx.server 为本逻辑服元数据，并回传 Action 绑定的 userId。
   */
  async executeLocal(raw: unknown): Promise<LogicActionReplyPayload> {
    const payload = raw as LogicActionRequestPayload;
    let boundUserId = 0n;

    const result = await this.skeleton.execute(
      {
        cmd: payload.cmd,
        subCmd: payload.subCmd,
        data: payload.data,
        headers: payload.headers,
        traceId: payload.traceId,
      },
      {
        onFlowContext: (ctx) => {
          ctx.setServer(this.serverInfo);
          if (payload.userId !== undefined && payload.userId !== '0') {
            ctx.bindingUserId(BigInt(payload.userId));
          }
        },
        onBound: (userId) => {
          boundUserId = userId;
        },
      },
    );

    return {
      data: result.data,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      userId: boundUserId !== 0n ? boundUserId.toString() : undefined,
    };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (CommunicationKit.getCrossServerRouter() === this.router) {
      CommunicationKit.clear();
    }
    this.rpc.unregisterHandler(RPC_HANDLER_ACTION);
    await this.rpc.stop();
    await this.broadcaster.stop();
    await this.registry.stop();
  }
}

/** RS1 便捷入口：等价于 `LogicServerHost.start(...)`。 */
export async function startLogicServer(options: LogicServerHostOptions): Promise<LogicServerHost> {
  return LogicServerHost.start(options);
}
