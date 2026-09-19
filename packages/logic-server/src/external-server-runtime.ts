import {
  BarSkeleton,
  CommunicationKit,
  createMemoryBroadcaster,
  type Broadcaster,
  type ConnectionObserver,
  type OnExternalContext,
} from '@nbb-ionet/core-framework';
import {
  type BaseExternalServer,
  type WebSocketExternalServer,
} from '@nbb-ionet/external-server';
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
import { RedisLogicRouter } from './redis-logic-router.js';
import { ServerBuilder } from './server-builder.js';
import { RPC_HANDLER_ON_EXTERNAL } from './protocol.js';

export interface ExternalServerRuntimeOptions {
  server: BaseExternalServer;
  /** WebSocket 外部服（提供连接注册表与上下线观测）；HTTP-only 部署可省略。 */
  wsServer?: WebSocketExternalServer;
  redisClient: RedisClient;
  pubSub: RedisPubSub;
  keyPrefix?: string;
  instanceId?: string;
  serverName?: string;
  serverTag?: string;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  defaultCallTimeoutMs?: number;
  /** 已构建的骨架；给出后自动安装跨服路由器（RS3）。 */
  skeleton?: BarSkeleton;
}

/**
 * RS6/RS7 —— 对外服的分布式运行时接线。
 *
 * 让一个「对外服」进程接入 Redis 逻辑服集群：
 * - 注册为 `serverType: 'external'`（RS2）；
 * - 把 ws 连接上下线登记到跨进程连接表（RS6）；
 * - 广播走 `DistributedBroadcasterDecorator`（定向通道 + 宕机显式报错）；
 * - 订阅 OnExternal 通道并注册 RPC `external.onExternal` handler；
 * - 安装 `RedisLogicRouter` 到骨架，使收不到本地 Action 的请求转发给逻辑服（RS3）。
 */
export class ExternalServerRuntime {
  readonly instanceId: string;
  readonly serverRecord: ServerRecord;
  readonly registry: ServerRegistry;
  readonly rpc: RedisRequestReply;
  readonly router: RedisLogicRouter;
  readonly connectionStore: ConnectionRegistryStore;
  readonly broadcaster: DistributedBroadcasterDecorator;
  readonly onExternalTransport: RedisOnExternalTransport;
  private stopped = false;

  private constructor(
    instanceId: string,
    serverRecord: ServerRecord,
    registry: ServerRegistry,
    rpc: RedisRequestReply,
    router: RedisLogicRouter,
    connectionStore: ConnectionRegistryStore,
    broadcaster: DistributedBroadcasterDecorator,
    onExternalTransport: RedisOnExternalTransport,
  ) {
    this.instanceId = instanceId;
    this.serverRecord = serverRecord;
    this.registry = registry;
    this.rpc = rpc;
    this.router = router;
    this.connectionStore = connectionStore;
    this.broadcaster = broadcaster;
    this.onExternalTransport = onExternalTransport;
  }

  static async start(options: ExternalServerRuntimeOptions): Promise<ExternalServerRuntime> {
    const { redisClient, pubSub, server, wsServer } = options;
    const instanceId = options.instanceId ?? redisClient.getInstanceId();

    const registry = new ServerRegistry(redisClient, pubSub, {
      keyPrefix: options.keyPrefix,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs,
    });
    await registry.start();

    const record = await registry.register(
      new ServerBuilder()
        .setId(instanceId)
        .setName(options.serverName ?? 'ExternalServer')
        .setTag(options.serverTag ?? options.serverName ?? 'ExternalServer')
        .setServerType('external')
        .setPort(server.port)
        .build(),
    );

    const rpc = new RedisRequestReply(redisClient, pubSub, {
      keyPrefix: options.keyPrefix,
      instanceId,
      defaultTimeoutMs: options.defaultCallTimeoutMs,
    });
    await rpc.start();
    rpc.registerHandler(RPC_HANDLER_ON_EXTERNAL, (payload) =>
      server.handleOnExternal(payload as OnExternalContext),
    );

    const connectionStore = new ConnectionRegistryStore(redisClient, {
      keyPrefix: options.keyPrefix,
    });
    if (wsServer) {
      const observer: ConnectionObserver = {
        onUserOnline: (userId) => connectionStore.bind(userId, instanceId),
        onUserOffline: (userId) => connectionStore.unbind(userId),
      };
      wsServer.setConnectionObserver(observer);
    }

    const { broadcaster: localBroadcaster, connections, rooms } = createMemoryBroadcaster(
      wsServer ? { connections: wsServer.connectionRegistry } : {},
    );
    const broadcaster = new DistributedBroadcasterDecorator(
      localBroadcaster,
      pubSub,
      connections,
      rooms,
      {
        instanceId,
        connectionStore,
        isInstanceAlive: (id) => registry.isAlive(id),
      },
    );
    await broadcaster.start();

    const onExternalTransport = new RedisOnExternalTransport(redisClient, pubSub, server.onExternal, {
      keyPrefix: options.keyPrefix,
      instanceId,
    });
    await onExternalTransport.start();

    const router = new RedisLogicRouter(registry, rpc, {
      selfInstanceId: instanceId,
      defaultTimeoutMs: options.defaultCallTimeoutMs,
    });
    CommunicationKit.setCrossServerRouter(router);
    options.skeleton?.setCrossServerRouter(router);

    return new ExternalServerRuntime(
      instanceId,
      record,
      registry,
      rpc,
      router,
      connectionStore,
      broadcaster,
      onExternalTransport,
    );
  }

  /** 对外服使用的 Broadcaster（可注入 Action / NestJS provider）。 */
  getBroadcaster(): Broadcaster {
    return this.broadcaster;
  }

  /** 骨架构建完成后调用，安装跨服路由器（RS3）。 */
  attachSkeleton(skeleton: BarSkeleton): void {
    skeleton.setCrossServerRouter(this.router);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (CommunicationKit.getCrossServerRouter() === this.router) {
      CommunicationKit.clear();
    }
    this.rpc.unregisterHandler(RPC_HANDLER_ON_EXTERNAL);
    await this.rpc.stop();
    await this.onExternalTransport.stop();
    await this.broadcaster.stop();
    await this.connectionStore.unbindInstance(this.instanceId);
    await this.registry.stop();
  }
}

export async function startExternalServerRuntime(
  options: ExternalServerRuntimeOptions,
): Promise<ExternalServerRuntime> {
  return ExternalServerRuntime.start(options);
}
