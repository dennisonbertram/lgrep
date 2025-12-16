import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
    },
    // Increase timeouts for I/O-heavy tests (LanceDB, filesystem)
    testTimeout: 15000,
    hookTimeout: 15000,
    // Limit parallelism to reduce I/O contention
    pool: 'forks',
    poolOptions: {
      forks: {
        // Run tests in parallel but limit concurrent workers
        maxForks: 4,
        minForks: 1,
      },
    },
    // Retry flaky tests once
    retry: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**'],
    },
  },
});
