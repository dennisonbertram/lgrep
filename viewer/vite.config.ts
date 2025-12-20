import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const viewerRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: viewerRoot,
  plugins: [react()],
  base: './',
  build: {
    outDir: resolve(viewerRoot, '..', 'dist', 'viewer'),
    emptyOutDir: true,
    sourcemap: false,
  },
});

