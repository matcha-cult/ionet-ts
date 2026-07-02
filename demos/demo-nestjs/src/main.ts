import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, Controller, Get } from '@nestjs/common';
import {
  ActionController,
  ActionMethod,
  DebugInOut,
} from '@nbb-ionet/core-framework';
import { IonetModule, IONET_BAR_SKELETON } from '@nbb-ionet/extension-nestjs';

const HALL_CMD = {
  cmd: 1,
  hello: 1,
  getUserInfo: 2,
} as const;

@ActionController(HALL_CMD.cmd)
class HallAction {
  @ActionMethod(HALL_CMD.hello)
  hello(name: string): string {
    return `Hello, ${name}!`;
  }

  @ActionMethod(HALL_CMD.getUserInfo)
  getUserInfo(userId: number): { userId: number; name: string; level: number } {
    return {
      userId,
      name: `User${userId}`,
      level: Math.floor(userId / 100) + 1,
    };
  }
}

@Controller()
class AppController {
  constructor() {}

  @Get()
  getHello(): string {
    return 'NestJS + ionet Demo Server';
  }
}

@Module({
  imports: [
    IonetModule.forRoot({
      actions: [HallAction],
      inOuts: [new DebugInOut()],
      httpServer: {
        port: 8080,
        host: 'localhost',
      },
      wsServer: {
        port: 8081,
        host: 'localhost',
      },
      redis: false,
    }),
  ],
  controllers: [AppController],
})
class AppModule {}

async function bootstrap() {
  console.log('=== NestJS + ionet Demo ===\n');

  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });

  await app.init();

  console.log('✓ NestJS app initialized');
  console.log('✓ HTTP server started on http://localhost:8080');
  console.log('✓ WebSocket server started on ws://localhost:8081');
  console.log('\nionet Endpoints:');
  console.log('  HTTP:  POST /api/{cmd}/{subCmd}');
  console.log('  WS:    Send JSON: { "cmd": number, "subCmd": number, "data": any }');
  console.log('\nNestJS Endpoints:');
  console.log('  GET    http://localhost:3000/');
  console.log('\nTry:');
  console.log('  curl -X POST http://localhost:8080/api/1/1 -H "Content-Type: application/json" -d \'{"data":"Alice"}\'');
  console.log('  curl -X POST http://localhost:8080/api/1/2 -H "Content-Type: application/json" -d \'{"data":12345}\'');
  console.log('\nPress Ctrl+C to stop servers');
}

bootstrap().catch(console.error);
