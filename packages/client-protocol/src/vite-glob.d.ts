/**
 * vite/vitest 的 import.meta.glob 类型（browser-safety.test.ts 使用）；
 * 仅测试期生效，不进入 dist 产物。
 */
interface ImportMeta {
  glob(
    pattern: string,
    options?: { as?: string; eager?: boolean },
  ): Record<string, string>;
}
