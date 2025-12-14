#!/usr/bin/env node

/**
 * Daemon worker process for file watching and incremental indexing.
 * This is spawned as a detached child process by the DaemonManager.
 */

import { watch, FSWatcher } from 'chokidar';

// Get arguments
const [, , indexName, rootPath] = process.argv;

if (!indexName || !rootPath) {
  console.error('Usage: worker.js <indexName> <rootPath>');
  process.exit(1);
}

let watcher: FSWatcher | null = null;
let isShuttingDown = false;

// Log startup
console.log(`[${new Date().toISOString()}] Worker started for index: ${indexName}`);
console.log(`[${new Date().toISOString()}] Watching path: ${rootPath}`);

// Set up graceful shutdown
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`[${new Date().toISOString()}] Received ${signal}, shutting down gracefully...`);

  if (watcher) {
    await watcher.close();
    console.log(`[${new Date().toISOString()}] Watcher closed`);
  }

  console.log(`[${new Date().toISOString()}] Worker stopped`);
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle errors
process.on('uncaughtException', (error) => {
  console.error(`[${new Date().toISOString()}] Uncaught exception:`, error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error(`[${new Date().toISOString()}] Unhandled rejection:`, reason);
  shutdown('unhandledRejection');
});

// Start watching
try {
  watcher = watch(rootPath, {
    ignored: [
      /(^|[\/\\])\../, // ignore dotfiles
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
    ],
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('ready', () => {
    console.log(`[${new Date().toISOString()}] Watcher ready, monitoring for changes...`);
  });

  watcher.on('add', (path) => {
    console.log(`[${new Date().toISOString()}] File added: ${path}`);
    // TODO: Trigger incremental indexing
  });

  watcher.on('change', (path) => {
    console.log(`[${new Date().toISOString()}] File changed: ${path}`);
    // TODO: Trigger incremental indexing
  });

  watcher.on('unlink', (path) => {
    console.log(`[${new Date().toISOString()}] File removed: ${path}`);
    // TODO: Trigger incremental indexing (removal)
  });

  watcher.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Watcher error:`, error);
  });

} catch (error) {
  console.error(`[${new Date().toISOString()}] Failed to start watcher:`, error);
  process.exit(1);
}

// Keep process alive
console.log(`[${new Date().toISOString()}] Worker process running with PID: ${process.pid}`);
