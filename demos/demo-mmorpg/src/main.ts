import 'reflect-metadata';
import {
  BarSkeletonBuilder,
  DebugInOut,
  SessionInOut,
  InMemorySessionStore,
  DefaultSessionManager,
} from '@nbb-ionet/core-framework';
import { HttpExternalServer, WebSocketExternalServer } from '@nbb-ionet/external-server';
import { RedisClient } from '@nbb-ionet/redis';

import { AuthService } from './services/auth-service.js';
import { UserService } from './services/user-service.js';
import { ItemService } from './services/item-service.js';
import { ProductionService } from './services/production-service.js';
import { ProductionWorker } from './worker/production-worker.js';

import { LoginAction } from './actions/login-action.js';
import { UserAction } from './actions/user-action.js';
import { ItemAction } from './actions/item-action.js';
import { IdleAction } from './actions/idle-action.js';

async function main() {
  console.log('=== ionet MMORPG Demo ===\n');

  // 初始化 Redis
  const redis = new RedisClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  });

  await redis.connect();
  console.log('✓ Redis connected');

  // 初始化 Services
  const authService = new AuthService(redis);
  const userService = new UserService(redis);
  const itemService = new ItemService(redis);
  const productionService = new ProductionService(redis, itemService);

  // 初始化 Worker
  const productionWorker = new ProductionWorker(redis, productionService);
  await productionWorker.start();

  // 初始化 Actions
  const loginAction = new LoginAction(authService);
  const userAction = new UserAction(userService);
  const itemAction = new ItemAction(itemService);
  const idleAction = new IdleAction(productionService, productionWorker);

  // 构建 Skeleton
  const sessionStore = new InMemorySessionStore();
  const sessionManager = new DefaultSessionManager(sessionStore);

  const skeleton = new BarSkeletonBuilder()
    .addAction(LoginAction, loginAction)
    .addAction(UserAction, userAction)
    .addAction(ItemAction, itemAction)
    .addAction(IdleAction, idleAction)
    .addInOut(new SessionInOut(sessionManager))
    .addInOut(new DebugInOut())
    .build();

  // 启动 HTTP Server
  const httpServer = new HttpExternalServer({
    port: 8080,
    host: 'localhost',
  });

  await httpServer.start(skeleton);
  console.log('✓ HTTP server started on http://localhost:8080');

  // 启动 WebSocket Server
  const wsServer = new WebSocketExternalServer({
    port: 8081,
    host: 'localhost',
  });

  await wsServer.start(skeleton);
  console.log('✓ WebSocket server started on ws://localhost:8081');

  console.log('\n=== MMORPG Demo Endpoints ===');
  console.log('\nLogin:');
  console.log('  POST /api/10/1  login       { account, password }');
  console.log('  POST /api/10/2  verify      { token }');
  console.log('\nUser:');
  console.log('  POST /api/20/1  getUserInfo { } (requires auth)');
  console.log('  POST /api/20/2  updateNickname { nickname } (requires auth)');
  console.log('  POST /api/20/3  addExp      { exp } (requires auth)');
  console.log('\nItem:');
  console.log('  POST /api/30/1  getBag      { } (requires auth)');
  console.log('  POST /api/30/2  addItem     { itemId, count } (requires auth)');
  console.log('  POST /api/30/3  useItem     { itemId, count } (requires auth)');
  console.log('\nIdle Production:');
  console.log('  POST /api/40/1  startTask   { taskType } (requires auth)');
  console.log('  POST /api/40/2  cancelTask  { } (requires auth)');
  console.log('  POST /api/40/3  getState    { } (requires auth)');
  console.log('  POST /api/40/4  addToQueue  { taskType } (requires auth)');
  console.log('\n=== Try ===');
  console.log('1. Login:');
  console.log('   curl -X POST http://localhost:8080/api/10/1 -H "Content-Type: application/json" -d \'{"data":{"account":"alice","password":"123"}}\'');
  console.log('\n2. Start production task:');
  console.log('   curl -X POST http://localhost:8080/api/40/1 -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d \'{"data":{"taskType":"wood"}}\'');
  console.log('\n3. Get state (after 3.3s, wood will be produced):');
  console.log('   curl -X POST http://localhost:8080/api/40/3 -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d \'{"data":{}}\'');
  console.log('\nPress Ctrl+C to stop servers');

  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    productionWorker.stop();
    await redis.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
