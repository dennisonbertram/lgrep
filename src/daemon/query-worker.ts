#!/usr/bin/env node
/**
 * Query worker process for daemon mode.
 * This is spawned as a detached child process to run the query server.
 */

import { QueryServer, ensureSocketsDir } from './query-server.js';
import { createWriteStream, WriteStream } from 'node:fs';

// Get arguments
const args = process.argv.slice(2);
const indexNameArg = args[0];
const logFilePath = args[1];

if (!indexNameArg) {
  console.error('Usage: query-worker.js <indexName> [logFilePath]');
  process.exit(1);
}

const indexName: string = indexNameArg;

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

let server: QueryServer | null = null;
let isShuttingDown = false;

// Log startup
log(`Query worker started for index: ${indexName}`);
log(`Worker process running with PID: ${process.pid}`);

// Set up graceful shutdown
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  log(`Received ${signal}, shutting down gracefully...`);

  if (server) {
    await server.stop();
    log('Server stopped');
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

// Start the server
async function main(): Promise<void> {
  try {
    // Ensure sockets directory exists
    ensureSocketsDir();

    // Create and initialize the server
    server = new QueryServer(indexName);
    log('Initializing server (loading index into memory)...');
    await server.initialize();
    log('Server initialized successfully');

    // Start listening
    await server.start();
    log('Server is ready to accept connections');
  } catch (error) {
    logError('Failed to start server', error);
    process.exit(1);
  }
}

main();

// Keep the process alive
setInterval(() => {
  // Heartbeat - keeps process alive
}, 30000);
