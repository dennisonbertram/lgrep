import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { getLgrepHome } from '../utils/paths.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';

/**
 * Log entry for an index.
 */
export interface LogEntry {
  indexName: string;
  logPath: string;
  size: number;
  modifiedAt: string;
  content?: string;
}

/**
 * Logs result.
 */
export interface LogsResult {
  success: boolean;
  logs?: LogEntry[];
  log?: LogEntry;
  error?: string;
}

/**
 * Options for logs command.
 */
export interface LogsOptions {
  index?: string;
  lines?: number;
  follow?: boolean;
  all?: boolean;
  json?: boolean;
}

/**
 * Get log file info and optionally content.
 */
function getLogEntry(logPath: string, indexName: string, lines?: number): LogEntry | null {
  if (!existsSync(logPath)) {
    return null;
  }

  try {
    const stat = statSync(logPath);
    const entry: LogEntry = {
      indexName,
      logPath,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };

    // Read content if requested
    if (lines !== undefined) {
      const content = readFileSync(logPath, 'utf-8');
      if (lines === 0) {
        // All lines
        entry.content = content;
      } else {
        // Last N lines
        const allLines = content.split('\n');
        entry.content = allLines.slice(-lines).join('\n');
      }
    }

    return entry;
  } catch {
    return null;
  }
}

/**
 * Run the logs command.
 */
export async function runLogsCommand(options: LogsOptions = {}): Promise<LogsResult> {
  const lgrepHome = getLgrepHome();
  const logsDir = join(lgrepHome, 'logs');

  if (!existsSync(logsDir)) {
    return {
      success: false,
      error: 'No logs directory found. Watchers may not have been started yet.',
    };
  }

  const lines = options.lines ?? 50; // Default to last 50 lines

  // List all logs
  if (options.all) {
    const logFiles = readdirSync(logsDir).filter(f => f.endsWith('.log'));
    const logs: LogEntry[] = [];

    for (const file of logFiles) {
      const indexName = file.replace('.log', '');
      const logPath = join(logsDir, file);
      const entry = getLogEntry(logPath, indexName, lines);
      if (entry) {
        logs.push(entry);
      }
    }

    if (logs.length === 0) {
      return {
        success: false,
        error: 'No log files found.',
      };
    }

    return {
      success: true,
      logs,
    };
  }

  // Get specific index or auto-detect
  let indexName: string = options.index ?? '';
  if (!indexName) {
    const detected = await detectIndexForDirectory(process.cwd());
    indexName = detected ?? basename(process.cwd());
  }

  const logPath = join(logsDir, `${indexName}.log`);
  const entry = getLogEntry(logPath, indexName, lines);

  if (!entry) {
    // List available logs
    const logFiles = readdirSync(logsDir).filter(f => f.endsWith('.log'));
    const available = logFiles.map(f => f.replace('.log', '')).join(', ');

    return {
      success: false,
      error: `No logs found for "${indexName}". Available: ${available || 'none'}`,
    };
  }

  return {
    success: true,
    log: entry,
  };
}

/**
 * Follow logs in real-time (like tail -f).
 */
export async function followLogs(indexName: string): Promise<void> {
  const lgrepHome = getLgrepHome();
  const logPath = join(lgrepHome, 'logs', `${indexName}.log`);

  if (!existsSync(logPath)) {
    console.error(`Log file not found: ${logPath}`);
    process.exit(1);
  }

  const { spawn } = await import('node:child_process');
  const tail = spawn('tail', ['-f', logPath], {
    stdio: 'inherit',
  });

  tail.on('error', (err) => {
    console.error(`Failed to follow logs: ${err.message}`);
    process.exit(1);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    tail.kill();
    process.exit(0);
  });
}
