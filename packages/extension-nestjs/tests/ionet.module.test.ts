import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionController, ActionMethod, BarSkeleton } from '@nbb-ionet/core-framework';
import {
  IonetModule,
  IonetFeatureModule,
  IONET_BAR_SKELETON,
  IONET_HTTP_SERVER,
  IONET_WS_SERVER,
  IONET_REDIS_CLIENT,
  IONET_MODULE_OPTIONS,
} from '../src/index.js';

const TEST_CMD = {
  cmd: 100,
  greet: 1,
  add: 2,
} as const;

@ActionController(TEST_CMD.cmd)
class TestAction {
  @ActionMethod(TEST_CMD.greet)
  greet(name: string): string {
    return `Hello, ${name}!`;
  }

  @ActionMethod(TEST_CMD.add)
  add(a: number, b: number): number {
    return a + b;
  }
}

describe('IonetModule', () => {
  describe('forRoot', () => {
    it('should create module with BarSkeleton provider', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          IonetModule.forRoot({
            actions: [TestAction],
            httpServer: false,
            wsServer: false,
            redis: false,
          }),
        ],
      }).compile();

      const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);
      expect(skeleton).toBeDefined();
      expect(skeleton).toBeInstanceOf(BarSkeleton);

      await moduleRef.close();
    });

    it('should register actions correctly', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          IonetModule.forRoot({
            actions: [TestAction],
            httpServer: false,
            wsServer: false,
            redis: false,
          }),
        ],
      }).compile();

      const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);

      const result = await skeleton.execute({
        cmd: TEST_CMD.cmd,
        subCmd: TEST_CMD.greet,
        data: 'World',
      });

      expect(result.data).toBe('Hello, World!');

      await moduleRef.close();
    });

    it('should not create HTTP server when disabled', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          IonetModule.forRoot({
            actions: [TestAction],
            httpServer: false,
            wsServer: false,
            redis: false,
          }),
        ],
      }).compile();

      const httpServer = moduleRef.get(IONET_HTTP_SERVER);
      expect(httpServer).toBeNull();

      await moduleRef.close();
    });

    it('should not create WebSocket server when disabled', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          IonetModule.forRoot({
            actions: [TestAction],
            httpServer: false,
            wsServer: false,
            redis: false,
          }),
        ],
      }).compile();

      const wsServer = moduleRef.get(IONET_WS_SERVER);
      expect(wsServer).toBeNull();

      await moduleRef.close();
    });

    it('should not create Redis client when disabled', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          IonetModule.forRoot({
            actions: [TestAction],
            httpServer: false,
            wsServer: false,
            redis: false,
          }),
        ],
      }).compile();

      const redisClient = moduleRef.get(IONET_REDIS_CLIENT);
      expect(redisClient).toBeNull();

      await moduleRef.close();
    });

    it('should apply settings to BarSkeleton', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          IonetModule.forRoot({
            actions: [TestAction],
            setting: {
              printSlow: true,
              slowThresholdMs: 500,
            },
            httpServer: false,
            wsServer: false,
            redis: false,
          }),
        ],
      }).compile();

      const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);
      expect(skeleton).toBeDefined();

      await moduleRef.close();
    });
  });

  describe('forRootAsync', () => {
    it('should support async configuration', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          IonetModule.forRootAsync({
            useFactory: () => ({
              actions: [TestAction],
              httpServer: false,
              wsServer: false,
              redis: false,
            }),
          }),
        ],
      }).compile();

      const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);
      expect(skeleton).toBeDefined();

      await moduleRef.close();
    });

    it('should support dependency injection in factory', async () => {
      const CONFIG_TOKEN = 'CONFIG';
      const configValue = { port: 9999 };

      @Module({
        providers: [{ provide: CONFIG_TOKEN, useValue: configValue }],
        exports: [CONFIG_TOKEN],
      })
      class ConfigModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [
          IonetModule.forRootAsync({
            useFactory: (config: typeof configValue) => ({
              actions: [TestAction],
              httpServer: config.port === 9999 ? false : { port: config.port },
              wsServer: false,
              redis: false,
            }),
            inject: [CONFIG_TOKEN],
            imports: [ConfigModule],
          }),
        ],
      }).compile();

      const skeleton = moduleRef.get<BarSkeleton>(IONET_BAR_SKELETON);
      expect(skeleton).toBeDefined();

      await moduleRef.close();
    });
  });

  describe('forFeature', () => {
    it('should provide actions for feature modules', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          IonetModule.forRoot({
            actions: [],
            httpServer: false,
            wsServer: false,
            redis: false,
          }),
          IonetFeatureModule.forFeature({
            actions: [TestAction],
          }),
        ],
      }).compile();

      expect(moduleRef).toBeDefined();

      await moduleRef.close();
    });
  });

  describe('Module Options', () => {
    it('should export IONET_MODULE_OPTIONS', () => {
      expect(IONET_MODULE_OPTIONS).toBeDefined();
      expect(typeof IONET_MODULE_OPTIONS).toBe('symbol');
    });

    it('should export IONET_BAR_SKELETON', () => {
      expect(IONET_BAR_SKELETON).toBeDefined();
      expect(typeof IONET_BAR_SKELETON).toBe('symbol');
    });
  });
});
