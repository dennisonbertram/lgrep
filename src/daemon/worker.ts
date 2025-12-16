/**
 * Daemon worker process for file watching and incremental indexing.
 * This is spawned as a detached child process by the DaemonManager.
 * Note: Shebang is added by tsup via banner config
 */

import { watch, FSWatcher } from 'chokidar';
import { createWriteStream, WriteStream } from 'node:fs';
import { ChangeDebouncer, triggerIncrementalIndex } from './worker-logic.js';

// Get arguments
const [, , indexName, rootPath, logFilePath] = process.argv;

if (!indexName || !rootPath) {
  console.error('Usage: worker.js <indexName> <rootPath> [logFilePath]');
  process.exit(1);
}

// Set up logging - write to log file if provided, otherwise use console
let logStream: WriteStream | null = null;

function log(message: string): void {
  const formatted = `[${new Date().toISOString()}] ${message}\n`;
  if (logStream) {
    logStream.write(formatted);
  } else {
    process.stdout.write(formatted);
  }
}

function logError(message: string, error?: unknown): void {
  const formatted = `[${new Date().toISOString()}] ${message}${error ? `: ${error}` : ''}\n`;
  if (logStream) {
    logStream.write(formatted);
  } else {
    process.stderr.write(formatted);
  }
}

// Initialize log file if path provided
if (logFilePath) {
  try {
    logStream = createWriteStream(logFilePath, { flags: 'a' });
  } catch (error) {
    // Fall back to console if we can't open log file
    console.error('Failed to open log file:', error);
  }
}

let watcher: FSWatcher | null = null;
let isShuttingDown = false;

// Create debouncer for file changes (1.5 second delay)
const debouncer = new ChangeDebouncer(1500, async (changedPaths: string[]) => {
  try {
    await triggerIncrementalIndex(indexName, rootPath, changedPaths);
  } catch (error) {
    logError('Failed to trigger incremental index', error);
  }
});

// Log startup
log(`Worker started for index: ${indexName}`);
log(`Watching path: ${rootPath}`);

// Set up graceful shutdown
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  log(`Received ${signal}, shutting down gracefully...`);

  // Flush any pending changes before shutting down
  try {
    await debouncer.flush();
    log('Flushed pending changes');
  } catch (error) {
    logError('Error flushing changes', error);
  }

  if (watcher) {
    await watcher.close();
    log('Watcher closed');
  }

  log('Worker stopped');

  // Close log stream before exiting
  if (logStream) {
    logStream.end();
  }

  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle errors
process.on('uncaughtException', (error) => {
  logError('Uncaught exception', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection', reason);
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

  // Log PID immediately so the manager can find it
  log(`Worker process running with PID: ${process.pid}`);

  watcher.on('ready', () => {
    log('Watcher ready, monitoring for changes...');
  });

  watcher.on('add', (path) => {
    log(`File added: ${path}`);
    debouncer.addChange(path);
  });

  watcher.on('change', (path) => {
    log(`File changed: ${path}`);
    debouncer.addChange(path);
  });

  watcher.on('unlink', (path) => {
    log(`File removed: ${path}`);
    debouncer.addChange(path);
  });

  watcher.on('error', (error) => {
    logError('Watcher error', error);
    // Don't exit on watcher errors - try to keep running
  });

} catch (error) {
  logError('Failed to start watcher', error);
  process.exit(1);
}

// Keep the process alive with a heartbeat interval
// This ensures the event loop stays active even if chokidar fails
setInterval(() => {
  // Heartbeat - keeps process alive
}, 30000);
