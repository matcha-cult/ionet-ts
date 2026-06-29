import 'reflect-metadata';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
  DebugInOut,
  StatActionInOut,
  SessionInOut,
  InMemorySessionStore,
  DefaultSessionManager,
  RateLimitInOut,
  AccessLogInOut,
} from '@ionet/core-framework';
import { HttpExternalServer, WebSocketExternalServer } from '@ionet/external-server';

const HALL_CMD = {
  cmd: 1,
  loginVerify: 1,
  hello: 2,
  getUserInfo: 3,
} as const;

@ActionController(HALL_CMD.cmd)
class HallAction {
  @ActionMethod(HALL_CMD.loginVerify)
  login(jwt: string): { id: number; nickname: string } {
    const id = jwt.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return { id, nickname: jwt };
  }

  @ActionMethod(HALL_CMD.hello)
  hello(userId: number): string {
    return `hello ${userId}`;
  }

  @ActionMethod(HALL_CMD.getUserInfo)
  getUserInfo(userId: number): { userId: number; name: string; level: number } {
    return { userId, name: `User${userId}`, level: Math.floor(userId / 100) + 1 };
  }
}

async function main() {
  console.log('=== ionet Phase 2 Demo ===\n');

  const sessionStore = new InMemorySessionStore();
  const sessionManager = new DefaultSessionManager(sessionStore);

  const skeleton = new BarSkeletonBuilder()
    .addAction(HallAction)
    .addInOut(new RateLimitInOut({ maxRequests: 100, windowMs: 60_000 }))
    .addInOut(new AccessLogInOut())
    .addInOut(new SessionInOut(sessionManager))
    .addInOut(new DebugInOut())
    .addInOut(new StatActionInOut())
    .build();

  const httpServer = new HttpExternalServer({
    port: 8080,
    host: 'localhost',
  });

  const wsServer = new WebSocketExternalServer({
    port: 8081,
    host: 'localhost',
  });

  await httpServer.start(skeleton);
  console.log('✓ HTTP server started on http://localhost:8080');

  await wsServer.start(skeleton);
  console.log('✓ WebSocket server started on ws://localhost:8081');

  console.log('\nEndpoints:');
  console.log('  HTTP:  POST /api/{cmd}/{subCmd}');
  console.log('  WS:    Send JSON: { "cmd": number, "subCmd": number, "data": any }');
  console.log('\nTry:');
  console.log('  curl -X POST http://localhost:8080/api/1/1 -H "Content-Type: application/json" -d \'{"data":"Alice"}\'');
  console.log('  curl -X POST http://localhost:8080/api/1/2 -H "Content-Type: application/json" -d \'{"data":12345}\'');
  console.log('  curl -X POST http://localhost:8080/api/1/3 -H "Content-Type: application/json" -d \'{"data":999}\'');
  console.log('\nPress Ctrl+C to stop servers');
}

main().catch(console.error);
