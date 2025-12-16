import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DaemonManager } from './manager.js';
import type { DaemonInfo } from './manager.js';

describe('DaemonManager', () => {
  const testHome = join(process.cwd(), 'test-daemon-home');
  const originalEnv = process.env;

  beforeEach(() => {
    // Set up test environment
    process.env = { ...originalEnv };
    process.env['LGREP_HOME'] = testHome;

    // Clean up test directory
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
    mkdirSync(testHome, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
    process.env = originalEnv;
  });

  describe('start', () => {
    it('should fail when rootPath does not exist', async () => {
      const manager = new DaemonManager();
      const nonExistentPath = '/path/that/does/not/exist';

      await expect(
        manager.start('test-index', nonExistentPath)
      ).rejects.toThrow('Root path does not exist');
    });

    it('should create PID and log directories if they do not exist', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      const pidDir = join(testHome, 'pids');
      const logDir = join(testHome, 'logs');

      expect(existsSync(pidDir)).toBe(false);
      expect(existsSync(logDir)).toBe(false);

      const info = await manager.start('test-index', rootPath);

      expect(existsSync(pidDir)).toBe(true);
      expect(existsSync(logDir)).toBe(true);

      // Clean up the daemon
      await manager.stop('test-index');
    });

    it('should start a daemon process and return DaemonInfo', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      const info = await manager.start('test-index', rootPath);

      expect(info).toMatchObject({
        indexName: 'test-index',
        rootPath,
        status: 'running',
      });
      expect(info.pid).toBeGreaterThan(0);
      expect(info.startedAt).toBeTruthy();

      // Clean up
      await manager.stop('test-index');
    });

    it('should write PID to file', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      const info = await manager.start('test-index', rootPath);
      const pidFile = join(testHome, 'pids', 'test-index.pid');

      expect(existsSync(pidFile)).toBe(true);
      const pidContent = readFileSync(pidFile, 'utf-8');
      const pidData = JSON.parse(pidContent);
      expect(pidData.pid).toBe(info.pid);

      // Clean up
      await manager.stop('test-index');
    });

    it('should fail if daemon is already running', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      await manager.start('test-index', rootPath);

      await expect(
        manager.start('test-index', rootPath)
      ).rejects.toThrow('Daemon is already running');

      // Clean up
      await manager.stop('test-index');
    });

    it('should create log file', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      await manager.start('test-index', rootPath);
      const logFile = join(testHome, 'logs', 'test-index.log');

      // Give the worker process time to spawn and create the log file
      // Worker now manages its own logging, so it may take a bit longer
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(existsSync(logFile)).toBe(true);

      // Clean up
      await manager.stop('test-index');
    }, 10000);
  });

  describe('stop', () => {
    it('should return false if daemon is not running', async () => {
      const manager = new DaemonManager();
      const result = await manager.stop('non-existent-index');
      expect(result).toBe(false);
    });

    it('should stop a running daemon', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      await manager.start('test-index', rootPath);
      const result = await manager.stop('test-index');

      expect(result).toBe(true);
    });

    it('should remove PID file after stopping', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      await manager.start('test-index', rootPath);
      const pidFile = join(testHome, 'pids', 'test-index.pid');

      expect(existsSync(pidFile)).toBe(true);

      await manager.stop('test-index');

      expect(existsSync(pidFile)).toBe(false);
    });

    it('should handle stale PID files gracefully', async () => {
      const manager = new DaemonManager();
      const pidDir = join(testHome, 'pids');
      mkdirSync(pidDir, { recursive: true });

      // Write a stale PID file (process that doesn't exist)
      const pidFile = join(pidDir, 'stale-index.pid');
      writeFileSync(pidFile, '999999');

      const result = await manager.stop('stale-index');
      expect(result).toBe(false);
      expect(existsSync(pidFile)).toBe(false); // Should clean up stale PID file
    });
  });

  describe('status', () => {
    it('should return null if daemon is not running', async () => {
      const manager = new DaemonManager();
      const status = await manager.status('non-existent-index');
      expect(status).toBe(null);
    });

    it('should return DaemonInfo for running daemon', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      const started = await manager.start('test-index', rootPath);
      const status = await manager.status('test-index');

      expect(status).toMatchObject({
        indexName: 'test-index',
        pid: started.pid,
        rootPath,
        status: 'running',
      });

      // Clean up
      await manager.stop('test-index');
    });

    it('should detect stopped daemon', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      const started = await manager.start('test-index', rootPath);
      await manager.stop('test-index');

      const status = await manager.status('test-index');
      expect(status).toBe(null);
    });

    it('should handle stale PID files in status check', async () => {
      const manager = new DaemonManager();
      const pidDir = join(testHome, 'pids');
      mkdirSync(pidDir, { recursive: true });

      // Write a stale PID file
      const pidFile = join(pidDir, 'stale-index.pid');
      writeFileSync(pidFile, '999999');

      const status = await manager.status('stale-index');
      expect(status).toBe(null);
      expect(existsSync(pidFile)).toBe(false); // Should clean up stale PID
    });
  });

  describe('list', () => {
    it('should return empty array if no daemons are running', async () => {
      const manager = new DaemonManager();
      const list = await manager.list();
      expect(list).toEqual([]);
    });

    it('should list all running daemons', async () => {
      const manager = new DaemonManager();
      const rootPath1 = join(testHome, 'test-repo-1');
      const rootPath2 = join(testHome, 'test-repo-2');
      mkdirSync(rootPath1, { recursive: true });
      mkdirSync(rootPath2, { recursive: true });

      await manager.start('test-index-1', rootPath1);
      await manager.start('test-index-2', rootPath2);

      const list = await manager.list();

      expect(list).toHaveLength(2);
      expect(list.find(d => d.indexName === 'test-index-1')).toBeTruthy();
      expect(list.find(d => d.indexName === 'test-index-2')).toBeTruthy();

      // Clean up
      await manager.stop('test-index-1');
      await manager.stop('test-index-2');
    });

    it('should filter out stale PID files when listing', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      // Start one real daemon
      await manager.start('test-index', rootPath);

      // Create a stale PID file
      const pidDir = join(testHome, 'pids');
      const stalePidFile = join(pidDir, 'stale-index.pid');
      writeFileSync(stalePidFile, '999999');

      const list = await manager.list();

      // Should only include the running daemon
      expect(list).toHaveLength(1);
      expect(list[0].indexName).toBe('test-index');

      // Stale PID should be cleaned up
      expect(existsSync(stalePidFile)).toBe(false);

      // Clean up
      await manager.stop('test-index');
    });
  });

  describe('PID file metadata', () => {
    it('should store rootPath and startedAt in PID file', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      const started = await manager.start('test-index', rootPath);
      const pidFile = join(testHome, 'pids', 'test-index.pid');

      const content = readFileSync(pidFile, 'utf-8');
      const data = JSON.parse(content);

      expect(data).toMatchObject({
        pid: started.pid,
        rootPath,
      });
      expect(data.startedAt).toBeTruthy();

      // Clean up
      await manager.stop('test-index');
    });

    it('should restore metadata when checking status', async () => {
      const manager = new DaemonManager();
      const rootPath = join(testHome, 'test-repo');
      mkdirSync(rootPath, { recursive: true });

      const started = await manager.start('test-index', rootPath);
      const status = await manager.status('test-index');

      expect(status).toMatchObject({
        indexName: 'test-index',
        pid: started.pid,
        rootPath: started.rootPath,
        startedAt: started.startedAt,
        status: 'running',
      });

      // Clean up
      await manager.stop('test-index');
    });
  });
});
