import { defineConfig } from 'tsup';

export default defineConfig([
  // CLI entry with shebang
  {
    entry: {
      'cli/index': 'src/cli/index.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node18',
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Daemon worker entry with shebang
  {
    entry: {
      'daemon/worker': 'src/daemon/worker.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    target: 'node18',
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Library entry without shebang
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    target: 'node18',
    shims: true,
  },
]);
