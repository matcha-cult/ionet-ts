import 'reflect-metadata';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
  DebugInOut,
  SessionInOut,
  DefaultSessionManager,
  AccessLogInOut,
} from '@nbb-ionet/core-framework';
import { HttpExternalServer, WebSocketExternalServer } from '@nbb-ionet/external-server';
import {
  RedisClient,
  RedisPubSub,
  RedisSessionStore,
  DistributedBroadcaster,
  DistributedRoom,
  DistributedLock,
  InstanceManager,
  GracefulShutdown,
} from '@nbb-ionet/redis';
import { GameServer } from './game/game-server.js';

const HALL_CMD = {
  cmd: 1,
  login: 1,
  hello: 2,
  broadcast: 3,
  joinRoom: 4,
  leaveRoom: 5,
  roomMessage: 6,
  trade: 7,
} as const;

const baseHttpPort = Number(process.env.HTTP_PORT ?? 8080);
const baseWsPort = Number(process.env.WS_PORT ?? 9080);
const baseGamePort = Number(process.env.GAME_PORT ?? 9090);
const instanceIndex = Number(process.env.INSTANCE_INDEX ?? 0);
const httpPort = baseHttpPort + instanceIndex;
const wsPort = baseWsPort + instanceIndex;
const gamePort = baseGamePort + instanceIndex;

@ActionController(HALL_CMD.cmd)
class HallAction {
  @ActionMethod(HALL_CMD.login)
  login(jwt: string): { id: number; nickname: string } {
    const id = jwt.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return { id, nickname: jwt };
  }

  @ActionMethod(HALL_CMD.hello)
  hello(userId: number): string {
    return `hello ${userId}`;
  }

  @ActionMethod(HALL_CMD.broadcast)
  broadcast(_data: unknown): { sent: true } {
    return { sent: true };
  }

  @ActionMethod(HALL_CMD.joinRoom)
  joinRoom(roomId: string): { joined: true; roomId: string } {
    return { joined: true, roomId };
  }

  @ActionMethod(HALL_CMD.leaveRoom)
  leaveRoom(roomId: string): { left: true; roomId: string } {
    return { left: true, roomId };
  }

  @ActionMethod(HALL_CMD.roomMessage)
  roomMessage(_data: { roomId: string; message: string }): { sent: true } {
    return { sent: true };
  }

  @ActionMethod(HALL_CMD.trade)
  trade(data: { item: string; price: number }): { success: boolean; item: string } {
    return { success: true, item: data.item };
  }
}

async function main(): Promise<void> {
  console.log(`\n=== ionet Phase 3 Cluster Demo ===`);
  console.log(`Instance Index: ${instanceIndex}`);
  console.log(`HTTP: ${httpPort}, WS: ${wsPort}, Game: ${gamePort}`);

  const redisClient = new RedisClient({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    instanceId: process.env.INSTANCE_ID,
  });

  await redisClient.connect();
  console.log(`✓ Redis connected (instance: ${redisClient.getInstanceId()})`);

  const pubSub = new RedisPubSub(redisClient);
  await pubSub.connect();

  const sessionStore = new RedisSessionStore(redisClient, { defaultTtl: 3600 });
  const sessionManager = new DefaultSessionManager(sessionStore);

  const broadcaster = new DistributedBroadcaster(redisClient, pubSub);
  await broadcaster.start();

  const room = new DistributedRoom(redisClient, pubSub);
  await room.start();

  const lock = new DistributedLock(redisClient, { defaultTtlMs: 30_000 });

  const gameServer = new GameServer({ port: gamePort, redisClient, pubSub });
  await gameServer.start();
  console.log(`✓ Game server (RPS) on :${gamePort}`);

  const instanceManager = new InstanceManager(redisClient, {
    metadata: { httpPort, wsPort, gamePort },
  });
  await instanceManager.register();
  console.log(`✓ Instance registered: ${instanceManager.getInstanceId()}`);

  room.onRoomMessage((roomId, data, senderId) => {
    console.log(`  [room:${roomId}] sender=${senderId} data=${JSON.stringify(data)}`);
  });

  broadcaster.onGlobalBroadcast((data) => {
    console.log(`  [broadcast] data=${JSON.stringify(data)}`);
  });

  const skeleton = new BarSkeletonBuilder()
    .addAction(HallAction)
    .addInOut(new AccessLogInOut())
    .addInOut(new SessionInOut(sessionManager))
    .addInOut(new DebugInOut())
    .build();

  const httpServer = new HttpExternalServer({ port: httpPort, host: '0.0.0.0' });
  const wsServer = new WebSocketExternalServer({ port: wsPort, host: '0.0.0.0' });

  await httpServer.start(skeleton);
  console.log(`✓ HTTP server on :${httpPort}`);

  await wsServer.start(skeleton);
  console.log(`✓ WebSocket server on :${wsPort}`);

  const shutdown = new GracefulShutdown({ timeoutMs: 10_000 });
  shutdown.addHandler(async () => {
    await gameServer.stop();
  });
  shutdown.register(redisClient, instanceManager, broadcaster, room, lock, pubSub);
  shutdown.start();

  const instances = await instanceManager.getInstances();
  console.log(`\n✓ Cluster has ${instances.length} instance(s)`);
  console.log(`\nEndpoints:`);
  console.log(`  Action HTTP : POST http://localhost:${httpPort}/api/{cmd}/{subCmd}`);
  console.log(`  Action WS   : ws://localhost:${wsPort}/ws`);
  console.log(`  Game (RPS)  : ws://localhost:${gamePort}`);
  console.log(`\nRun game demo:  pnpm --filter @nbb-ionet/demo-cluster run game`);
  console.log(`Press Ctrl+C to stop.\n`);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
