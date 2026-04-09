import { build } from 'tsup';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const force = args.has('--force');

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcRoot = join(repoRoot, 'src');
const distRoot = join(repoRoot, 'dist');
const entryTargets = [
  join(distRoot, 'cli', 'index.js'),
  join(distRoot, 'daemon', 'worker.js'),
  join(distRoot, 'daemon', 'query-worker.js'),
];

function listTypeScriptFiles(root) {
  const files = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function getNewestSourceMtimeMs() {
  const sourceFiles = listTypeScriptFiles(srcRoot);
  return sourceFiles.reduce((newest, filePath) => {
    return Math.max(newest, statSync(filePath).mtimeMs);
  }, 0);
}

function needsBuild() {
  if (force) {
    return true;
  }

  if (entryTargets.some((target) => !existsSync(target))) {
    return true;
  }

  const newestSourceMtimeMs = getNewestSourceMtimeMs();
  return entryTargets.some((target) => statSync(target).mtimeMs < newestSourceMtimeMs);
}

if (needsBuild()) {
  await build({
    entry: {
      'cli/index': join(srcRoot, 'cli', 'index.ts'),
      'daemon/worker': join(srcRoot, 'daemon', 'worker.ts'),
      'daemon/query-worker': join(srcRoot, 'daemon', 'query-worker.ts'),
    },
    outDir: distRoot,
    format: ['esm'],
    target: 'node18',
    shims: true,
    clean: false,
    silent: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  });
}
