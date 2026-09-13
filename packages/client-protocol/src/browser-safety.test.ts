/**
 * A3 任务 2 · 浏览器安全断言。
 *
 * 1) 包源码（含测试自身）零 Node 内置引用（协议验收 grep 零命中——本文件刻意不出现该字面量）；
 * 2) 源码（非测试）零裸第三方/Node 模块导入 —— 本包零 Node 依赖，零 npm 依赖；
 * 3) 构建产物（dist）同样零 Node 内置、纯 ESM（无 CommonJS require/process/Buffer 调用）——
 *    browser-safe，可被浏览器 <script type="module"> / bundler 直接消费；
 * 4) exports 明确声明 browser/import 条件出口（§2.3）；
 * 5) 产物可在浏览器 ESM 环境 import：本文件以 Node ESM 动态 import 验证模块可加载且导出齐全
 *    （源码仅使用 Web 标准 API：JSON/对象操作，无任何宿主内置依赖）。
 *
 * 注意：dist 相关断言要求先执行 `pnpm --filter @nbb-ionet/client-protocol run build`。
 */
import { describe, it, expect } from 'vitest';
import pkgJson from '../package.json';
import distIndexRaw from '../dist/index.js?raw';

// vite raw 读取全部 src 源码（含本文件自检；本文件不出现被查字面量，保证 grep 验收零命中）
const sourceFiles = import.meta.glob('./**/*.ts', { as: 'raw', eager: true });

// 动态拼出 'node' + ':'，避免本文件自身出现该字面量（自检 + 验收 grep 双重约束）
const NODE_PREFIX = 'node' + ':' as string;
const NODE_SPECIFIER = new RegExp('(^|[^A-Za-z0-9_$.])' + NODE_PREFIX);

// 仅用于 dist 产物的加强检查（dist 不参与 src 自扫，出现字面量无碍）
const CJS_REQUIRE = /\brequire\s*\(/;
const PROCESS_REF = /\bprocess\s*\./;
const BUFFER_REF = /\bBuffer\b/;
const IMPORT_SPEC = /(?:import\s*\(|from\s+)(['"])([^'"]+)\1/g;

describe('浏览器安全 · 包源码（src）', () => {
  const entries = Object.entries(sourceFiles);
  it('src 存在可扫描文件', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('源码零 Node 内置引用（含测试文件自身）', () => {
    for (const [path, source] of entries) {
      expect(source, path).not.toMatch(NODE_SPECIFIER);
    }
  });

  it('源码（非测试）零裸导入：仅允许相对导入（./ ../），无第三方/Node 依赖', () => {
    const impl = entries.filter(([p]) => !p.endsWith('.test.ts'));
    expect(impl.length).toBeGreaterThan(0);
    for (const [path, source] of impl) {
      IMPORT_SPEC.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = IMPORT_SPEC.exec(source)) !== null) {
        const spec = m[2];
        const ok = spec.startsWith('./') || spec.startsWith('../');
        expect(ok, path + ' 存在裸导入: ' + spec).toBe(true);
      }
    }
  });
});

describe('浏览器安全 · exports 出口（§2.3）', () => {
  it("'.' 明确声明 types/browser/import 条件出口", () => {
    const main = (pkgJson as any).exports['.'];
    expect(main.types).toBe('./dist/index.d.ts');
    expect(main.browser).toBe('./dist/index.js');
    expect(main.import).toBe('./dist/index.js');
  });

  it("'./testing' 子路径同样声明 types/browser/import", () => {
    const testing = (pkgJson as any).exports['./testing'];
    expect(testing.types).toBe('./dist/testing.d.ts');
    expect(testing.browser).toBe('./dist/testing.js');
    expect(testing.import).toBe('./dist/testing.js');
  });

  it('运行时依赖为零（dependencies 为空对象）', () => {
    expect(pkgJson.dependencies).toEqual({});
  });
});

describe('浏览器安全 · 构建产物（dist，需先 build）', () => {
  it('dist/index.js 产物已生成（先执行 pnpm --filter @nbb-ionet/client-protocol run build）', () => {
    expect(distIndexRaw.length).toBeGreaterThan(0);
  });

  it('产物零 Node 内置引用', () => {
    expect(distIndexRaw).not.toMatch(NODE_SPECIFIER);
  });

  it('产物为纯 ESM：无 CommonJS require(/process./Buffer 调用', () => {
    expect(distIndexRaw).not.toMatch(CJS_REQUIRE);
    expect(distIndexRaw).not.toMatch(PROCESS_REF);
    expect(distIndexRaw).not.toMatch(BUFFER_REF);
  });

  it('产物可在 ESM 环境动态 import 且导出齐全（浏览器 ESM 可加载性）', async () => {
    const mod = (await import('../dist/index.js')) as Record<string, unknown>;
    for (const name of [
      'EnvelopeCodec',
      'RequestResponseAssociator',
      'classifyFrame',
      'isNotificationFrame',
      'createRequestMessage',
      'createResponseMessage',
      'createNotificationMessage',
      'isSuccess',
    ]) {
      expect(name in mod, '缺少导出: ' + name).toBe(true);
    }
    expect(typeof mod.EnvelopeCodec).toBe('function');
    expect(typeof mod.RequestResponseAssociator).toBe('function');
    // 冒烟：用产物实现做一次编码/分流/关联
    const codec = new (mod.EnvelopeCodec as new () => { encode(m: unknown): string } )();
    expect(codec.encode({ kind: 'notification', data: 1 })).toBe('{"kind":"notification","data":1}');
  });
});

export {};
