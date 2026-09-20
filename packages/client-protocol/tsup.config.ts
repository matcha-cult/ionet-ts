import { defineConfig } from 'tsup';

/**
 * @nbb-ionet/client-protocol 构建：浏览器安全产物（platform: browser）。
 * 包源码零 Node 依赖，产物为纯 ESM，可直接被浏览器 <script type="module"> / bundler 消费。
 * ./testing 子路径（A3 任务 3）：与 A1 套件共享的协议一致性金样，单独成包供测试复用。
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    testing: 'src/testing.ts',
  },
  platform: 'browser',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
