import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { IonetModule } from '../src/index.js';

const ORIGINAL = process.env.NODE_ENV;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL;
});

const baseOptions = { actions: [], httpServer: false, wsServer: false, redis: false } as const;

describe('extension-nestjs 生产环境守卫（可配置）', () => {
  it('NODE_ENV=production 且未显式允许 -> forRoot 抛错', () => {
    process.env.NODE_ENV = 'production';
    expect(() => IonetModule.forRoot({ ...baseOptions })).toThrow(/禁止在生产环境运行/);
  });

  it('allowProduction=true -> 放行', () => {
    process.env.NODE_ENV = 'production';
    expect(() => IonetModule.forRoot({ ...baseOptions, allowProduction: true })).not.toThrow();
  });

  it('allowProduction=false 显式给出 -> 仍抛错', () => {
    process.env.NODE_ENV = 'production';
    expect(() => IonetModule.forRoot({ ...baseOptions, allowProduction: false })).toThrow();
  });

  it('非 production 环境默认放行', () => {
    process.env.NODE_ENV = 'development';
    expect(() => IonetModule.forRoot({ ...baseOptions })).not.toThrow();
  });

  it('未设置 NODE_ENV 时放行', () => {
    delete process.env.NODE_ENV;
    expect(() => IonetModule.forRoot({ ...baseOptions })).not.toThrow();
  });

  it('forFeature 不再自行断言（生产+allowProduction 时不因 forFeature 抛错）', () => {
    process.env.NODE_ENV = 'production';
    expect(() => IonetModule.forRoot({ ...baseOptions, allowProduction: true })).not.toThrow();
  });
});
