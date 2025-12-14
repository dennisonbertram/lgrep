import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMgrepHome } from '../cli/utils/paths.js';

export interface DaemonInfo {
  indexName: string;
  pid: number;
  rootPath: string;
  startedAt: string;
  status: 'running' | 'stopped' | 'unknown';
}

interface PidFileData {
  pid: number;
  rootPath: string;
  startedAt: string;
}

export class DaemonManager {
  private getPidDir(): string {
    return join(getMgrepHome(), 'pids');
  }

  private getLogDir(): string {
    return join(getMgrepHome(), 'logs');
  }

  private getPidFilePath(indexName: string): string {
    return join(this.getPidDir(), `${indexName}.pid`);
  }

  private getLogFilePath(indexName: string): string {
    return join(this.getLogDir(), `${indexName}.log`);
  }

  private ensureDirectories(): void {
    const pidDir = this.getPidDir();
    const logDir = this.getLogDir();

    if (!existsSync(pidDir)) {
      mkdirSync(pidDir, { recursive: true });
    }

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  private readPidFile(indexName: string): PidFileData | null {
    const pidFile = this.getPidFilePath(indexName);

    if (!existsSync(pidFile)) {
      return null;
    }

    try {
      const content = readFileSync(pidFile, 'utf-8');
      const data: PidFileData = JSON.parse(content);
      return data;
    } catch (error) {
      // Invalid PID file, clean it up
      this.cleanupPidFile(indexName);
      return null;
    }
  }

  private cleanupPidFile(indexName: string): void {
    const pidFile = this.getPidFilePath(indexName);
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }
  }

  private writePidFile(indexName: string, data: PidFileData): void {
    const pidFile = this.getPidFilePath(indexName);
    writeFileSync(pidFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  async start(indexName: string, rootPath: string): Promise<DaemonInfo> {
    // Validate root path exists
    if (!existsSync(rootPath)) {
      throw new Error(`Root path does not exist: ${rootPath}`);
    }

    // Check if daemon is already running
    const existing = await this.status(indexName);
    if (existing && existing.status === 'running') {
      throw new Error(`Daemon is already running for index: ${indexName}`);
    }

    // Ensure directories exist
    this.ensureDirectories();

    // Get the worker script path
    const workerPath = this.getWorkerPath();

    // Open log file
    const logFile = this.getLogFilePath(indexName);

    // Spawn the daemon process
    const child = spawn(
      process.execPath,
      [workerPath, indexName, rootPath],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    // Redirect stdout and stderr to log file
    const logStream = createWriteStream(logFile, { flags: 'a' });
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    // Unref so parent can exit
    child.unref();

    const pid = child.pid!;
    const startedAt = new Date().toISOString();

    // Write PID file
    const pidData: PidFileData = {
      pid,
      rootPath,
      startedAt,
    };
    this.writePidFile(indexName, pidData);

    return {
      indexName,
      pid,
      rootPath,
      startedAt,
      status: 'running',
    };
  }

  async stop(indexName: string): Promise<boolean> {
    const pidData = this.readPidFile(indexName);

    if (!pidData) {
      return false;
    }

    const { pid } = pidData;

    // Check if process is actually running
    if (!this.isProcessRunning(pid)) {
      // Clean up stale PID file
      this.cleanupPidFile(indexName);
      return false;
    }

    try {
      // Send SIGTERM for graceful shutdown
      process.kill(pid, 'SIGTERM');

      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 100));

      // If still running, send SIGKILL
      if (this.isProcessRunning(pid)) {
        process.kill(pid, 'SIGKILL');
      }

      // Clean up PID file
      this.cleanupPidFile(indexName);

      return true;
    } catch (error) {
      // Process might have already exited
      this.cleanupPidFile(indexName);
      return false;
    }
  }

  async status(indexName: string): Promise<DaemonInfo | null> {
    const pidData = this.readPidFile(indexName);

    if (!pidData) {
      return null;
    }

    const { pid, rootPath, startedAt } = pidData;

    // Check if process is actually running
    if (!this.isProcessRunning(pid)) {
      // Clean up stale PID file
      this.cleanupPidFile(indexName);
      return null;
    }

    return {
      indexName,
      pid,
      rootPath,
      startedAt,
      status: 'running',
    };
  }

  async list(): Promise<DaemonInfo[]> {
    const pidDir = this.getPidDir();

    if (!existsSync(pidDir)) {
      return [];
    }

    const pidFiles = readdirSync(pidDir).filter(f => f.endsWith('.pid'));
    const daemons: DaemonInfo[] = [];

    for (const pidFile of pidFiles) {
      const indexName = pidFile.replace('.pid', '');
      const info = await this.status(indexName);

      if (info) {
        daemons.push(info);
      }
    }

    return daemons;
  }

  private getWorkerPath(): string {
    // Get the directory of the current file
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);

    // Worker is in the same directory
    return join(currentDir, 'worker.js');
  }
}
