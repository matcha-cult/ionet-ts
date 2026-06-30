import type { Config } from 'vitest/config';

const config: Config = {
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};

export default config;
