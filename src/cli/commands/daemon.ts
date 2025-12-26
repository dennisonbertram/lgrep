/**
 * Daemon command for managing query servers.
 * Keeps the index loaded in memory for instant queries.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLgrepHome } from '../utils/paths.js';
import { getSocketPath } from '../../daemon/query-server.js';
import { createQueryClient } from '../../daemon/query-client.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';

export interface DaemonOptions {
  json?: boolean;
}

export interface DaemonInfo {
  indexName: string;
  pid: number;
  startedAt: string;
  status: 'running' | 'stopped' | 'unknown';
  socketPath: string;
}

interface PidFileData {
  pid: number;
  startedAt: string;
}

/**
 * Get the PID directory for daemon processes.
 */
function getPidDir(): string {
  return join(getLgrepHome(), 'daemon-pids');
}

/**
 * Get the log directory for daemon processes.
 */
function getLogDir(): string {
  return join(getLgrepHome(), 'daemon-logs');
}

/**
 * Get the PID file path for an index.
 */
function getPidFilePath(indexName: string): string {
  return join(getPidDir(), `${indexName}.pid`);
}

/**
 * Get the log file path for an index.
 */
function getLogFilePath(indexName: string): string {
  return join(getLogDir(), `${indexName}.log`);
}

/**
 * Ensure directories exist.
 */
function ensureDirectories(): void {
  const pidDir = getPidDir();
  const logDir = getLogDir();
  const socketsDir = join(getLgrepHome(), 'sockets');

  for (const dir of [pidDir, logDir, socketsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Check if a process is running.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read PID file.
 */
function readPidFile(indexName: string): PidFileData | null {
  const pidFile = getPidFilePath(indexName);

  if (!existsSync(pidFile)) {
    return null;
  }

  try {
    const content = readFileSync(pidFile, 'utf-8');
    return JSON.parse(content) as PidFileData;
  } catch {
    return null;
  }
}

/**
 * Write PID file.
 */
function writePidFile(indexName: string, data: PidFileData): void {
  const pidFile = getPidFilePath(indexName);
  writeFileSync(pidFile, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Clean up PID file.
 */
function cleanupPidFile(indexName: string): void {
  const pidFile = getPidFilePath(indexName);
  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
  }
}

/**
 * Get the query worker script path.
 */
function getWorkerPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  // Multiple possible locations
  const possiblePaths = [
    join(currentDir, '..', '..', 'daemon', 'query-worker.js'),
    join(dirname(currentDir), 'daemon', 'query-worker.js'),
  ];

  // If running from src, also check dist
  if (currentDir.includes('/src/')) {
    const projectRoot = currentDir.split('/src/')[0] as string;
    possiblePaths.push(join(projectRoot, 'dist', 'daemon', 'query-worker.js'));
  }

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  throw new Error(`Query worker script not found. Searched: ${possiblePaths.join(', ')}`);
}

/**
 * Start the daemon for an index.
 */
export async function runDaemonStartCommand(
  indexNameArg?: string,
  options: DaemonOptions = {}
): Promise<{ success: boolean; daemon?: DaemonInfo; error?: string }> {
  try {
    // Auto-detect index if not provided
    let indexName: string;
    if (indexNameArg) {
      indexName = indexNameArg;
    } else {
      const detected = await detectIndexForDirectory();
      if (!detected) {
        throw new Error(
          'No index found for current directory. Either:\n' +
          '  1. Specify the index name: lgrep daemon start <index>\n' +
          '  2. Run `lgrep index .` to index the current directory\n' +
          '  3. Navigate to an indexed directory'
        );
      }
      indexName = detected;
    }

    // Check if already running
    const existing = await getDaemonStatus(indexName);
    if (existing && existing.status === 'running') {
      return {
        success: true,
        daemon: existing,
        error: 'Daemon is already running',
      };
    }

    // Ensure directories exist
    ensureDirectories();

    // Get the worker script path
    const workerPath = getWorkerPath();

    // Get log file path
    const logFile = getLogFilePath(indexName);
    if (existsSync(logFile)) {
      unlinkSync(logFile);
    }

    // Spawn the daemon
    const child = spawn(
      'sh',
      [
        '-c',
        `"${process.execPath}" "${workerPath}" "${indexName}" "${logFile}" &`,
      ],
      {
        detached: true,
        stdio: 'ignore',
        shell: false,
      }
    );

    child.on('error', (err) => {
      console.error(`Failed to spawn daemon: ${err.message}`);
    });

    child.unref();

    // Wait for the worker to start
    await new Promise(resolve => setTimeout(resolve, 500));

    // Find the actual worker PID from the log
    let pid: number | undefined;
    for (let i = 0; i < 20; i++) {
      if (existsSync(logFile)) {
        const logContent = readFileSync(logFile, 'utf-8');
        const match = logContent.match(/Worker process running with PID: (\d+)/);
        if (match && match[1]) {
          pid = parseInt(match[1], 10);
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (!pid) {
      let logContent = '';
      if (existsSync(logFile)) {
        logContent = readFileSync(logFile, 'utf-8');
      }
      throw new Error(`Failed to start daemon - could not find worker PID. Log: ${logContent || '(empty)'}`);
    }

    if (!isProcessRunning(pid)) {
      let logContent = '';
      if (existsSync(logFile)) {
        logContent = readFileSync(logFile, 'utf-8');
      }
      throw new Error(`Daemon process died immediately after spawning. Log:\n${logContent || '(no log)'}`);
    }

    const startedAt = new Date().toISOString();

    // Write PID file
    writePidFile(indexName, { pid, startedAt });

    // Wait for server to be ready (socket created)
    const socketPath = getSocketPath(indexName);
    for (let i = 0; i < 30; i++) {
      if (existsSync(socketPath)) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return {
      success: true,
      daemon: {
        indexName,
        pid,
        startedAt,
        status: 'running',
        socketPath,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Stop the daemon for an index.
 */
export async function runDaemonStopCommand(
  indexNameArg?: string,
  options: DaemonOptions = {}
): Promise<{ success: boolean; stopped?: boolean; error?: string }> {
  try {
    // Auto-detect index if not provided
    let indexName: string;
    if (indexNameArg) {
      indexName = indexNameArg;
    } else {
      const detected = await detectIndexForDirectory();
      if (!detected) {
        throw new Error(
          'No index found for current directory. Either:\n' +
          '  1. Specify the index name: lgrep daemon stop <index>\n' +
          '  2. Navigate to an indexed directory'
        );
      }
      indexName = detected;
    }

    const pidData = readPidFile(indexName);

    if (!pidData) {
      return { success: true, stopped: false, error: 'Daemon is not running' };
    }

    const { pid } = pidData;

    if (!isProcessRunning(pid)) {
      cleanupPidFile(indexName);
      return { success: true, stopped: false, error: 'Daemon was not running (stale PID file cleaned up)' };
    }

    try {
      // Send SIGTERM for graceful shutdown
      process.kill(pid, 'SIGTERM');

      // Wait for shutdown
      await new Promise(resolve => setTimeout(resolve, 200));

      // If still running, send SIGKILL
      if (isProcessRunning(pid)) {
        process.kill(pid, 'SIGKILL');
      }

      // Clean up
      cleanupPidFile(indexName);

      // Clean up socket file
      const socketPath = getSocketPath(indexName);
      if (existsSync(socketPath)) {
        unlinkSync(socketPath);
      }

      return { success: true, stopped: true };
    } catch {
      cleanupPidFile(indexName);
      return { success: true, stopped: false };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get daemon status for an index.
 */
export async function getDaemonStatus(indexName: string): Promise<DaemonInfo | null> {
  const pidData = readPidFile(indexName);

  if (!pidData) {
    return null;
  }

  const { pid, startedAt } = pidData;

  if (!isProcessRunning(pid)) {
    cleanupPidFile(indexName);
    return null;
  }

  return {
    indexName,
    pid,
    startedAt,
    status: 'running',
    socketPath: getSocketPath(indexName),
  };
}

/**
 * List all running daemons.
 */
export async function runDaemonListCommand(
  options: DaemonOptions = {}
): Promise<{ success: boolean; daemons?: DaemonInfo[]; error?: string }> {
  try {
    ensureDirectories();
    const pidDir = getPidDir();

    if (!existsSync(pidDir)) {
      return { success: true, daemons: [] };
    }

    const pidFiles = readdirSync(pidDir).filter(f => f.endsWith('.pid'));
    const daemons: DaemonInfo[] = [];

    for (const pidFile of pidFiles) {
      const indexName = pidFile.replace('.pid', '');
      const info = await getDaemonStatus(indexName);

      if (info) {
        daemons.push(info);
      }
    }

    return { success: true, daemons };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Query the daemon for an index.
 */
export async function runDaemonQueryCommand(
  method: string,
  params: Record<string, unknown> = {},
  indexNameArg?: string,
  options: DaemonOptions = {}
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    // Auto-detect index if not provided
    let indexName: string;
    if (indexNameArg) {
      indexName = indexNameArg;
    } else {
      const detected = await detectIndexForDirectory();
      if (!detected) {
        throw new Error(
          'No index found for current directory. Either:\n' +
          '  1. Use --index <name> to specify an index\n' +
          '  2. Navigate to an indexed directory'
        );
      }
      indexName = detected;
    }

    // Check if daemon is running
    const status = await getDaemonStatus(indexName);
    if (!status) {
      throw new Error(`Daemon is not running for index "${indexName}". Start it with: lgrep daemon start ${indexName}`);
    }

    // Connect and query
    const client = await createQueryClient(indexName);
    try {
      const result = await client.request(method, params);
      return { success: true, result };
    } finally {
      client.disconnect();
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * View daemon logs.
 */
export async function runDaemonLogsCommand(
  indexNameArg?: string,
  options: DaemonOptions & { tail?: number } = {}
): Promise<{ success: boolean; logs?: string; error?: string }> {
  try {
    // Auto-detect index if not provided
    let indexName: string;
    if (indexNameArg) {
      indexName = indexNameArg;
    } else {
      const detected = await detectIndexForDirectory();
      if (!detected) {
        throw new Error(
          'No index found for current directory. Either:\n' +
          '  1. Specify the index name: lgrep daemon logs <index>\n' +
          '  2. Navigate to an indexed directory'
        );
      }
      indexName = detected;
    }

    const logFile = getLogFilePath(indexName);

    if (!existsSync(logFile)) {
      return { success: true, logs: '(no logs found)' };
    }

    let logs = readFileSync(logFile, 'utf-8');

    // Optionally tail the logs
    if (options.tail) {
      const lines = logs.split('\n');
      logs = lines.slice(-options.tail).join('\n');
    }

    return { success: true, logs };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
