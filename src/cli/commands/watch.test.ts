import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runWatchCommand } from './watch.js';
import { DaemonManager } from '../../daemon/manager.js';
import { runIndexCommand } from './index.js';
import { openDatabase, getIndex } from '../../storage/lance.js';

// Mock the daemon manager class
vi.mock('../../daemon/manager.js', () => {
  const DaemonManager = vi.fn();
  DaemonManager.prototype.start = vi.fn();
  DaemonManager.prototype.status = vi.fn();
  return { DaemonManager };
});

// Mock the index command
vi.mock('./index.js', () => ({
  runIndexCommand: vi.fn(),
}));

// Mock the storage/lance module
vi.mock('../../storage/lance.js', () => ({
  openDatabase: vi.fn(),
  getIndex: vi.fn(),
}));

describe('watch command', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-watch-cmd-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    // Save and override LGREP_HOME
    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    // Reset mocks
    vi.clearAllMocks();

    // Setup default mocks for database operations
    const mockDb = { path: testDir, connection: {}, close: vi.fn() };
    vi.mocked(openDatabase).mockResolvedValue(mockDb as never);
    vi.mocked(getIndex).mockResolvedValue({
      name: 'test-index',
      metadata: {} as never,
      table: null
    });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
  });

  describe('basic functionality', () => {
    it('should start a watcher for a directory', async () => {
      const mockDaemonInfo = {
        indexName: 'test-index',
        pid: 12345,
        rootPath: testDir,
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(null);
      vi.mocked(DaemonManager.prototype.start).mockResolvedValue(mockDaemonInfo);

      const result = await runWatchCommand(testDir, {
        name: 'test-index',
      });

      expect(result.success).toBe(true);
      expect(result.indexName).toBe('test-index');
      expect(result.pid).toBe(12345);
      expect(result.path).toBe(testDir);
    });

    it('should use basename as default index name', async () => {
      const expectedIndexName = testDir.split('/').pop()!;
      const mockDaemonInfo = {
        indexName: expectedIndexName,
        pid: 12345,
        rootPath: testDir,
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(null);
      vi.mocked(DaemonManager.prototype.start).mockResolvedValue(mockDaemonInfo);

      const result = await runWatchCommand(testDir);

      expect(result.indexName).toMatch(/lgrep-watch-cmd-test-/);
    });

    it('should throw error if watcher already running', async () => {
      const mockDaemonInfo = {
        indexName: 'test-index',
        pid: 12345,
        rootPath: testDir,
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(mockDaemonInfo);

      await expect(
        runWatchCommand(testDir, { name: 'test-index' })
      ).rejects.toThrow(/already running/i);
    });

    it('should throw error if path does not exist', async () => {
      const nonExistentPath = join(testDir, 'nonexistent');

      await expect(
        runWatchCommand(nonExistentPath, { name: 'test-index' })
      ).rejects.toThrow(/does not exist/i);
    });
  });

  describe('JSON output', () => {
    it('should return structured JSON data', async () => {
      const mockDaemonInfo = {
        indexName: 'test-index',
        pid: 12345,
        rootPath: testDir,
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(null);
      vi.mocked(DaemonManager.prototype.start).mockResolvedValue(mockDaemonInfo);

      const result = await runWatchCommand(testDir, {
        name: 'test-index',
        json: true,
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('indexName');
      expect(result).toHaveProperty('pid');
      expect(result).toHaveProperty('path');
    });
  });

  describe('text output formatting', () => {
    it('should format human-readable output', async () => {
      const mockDaemonInfo = {
        indexName: 'test-index',
        pid: 12345,
        rootPath: testDir,
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(null);
      vi.mocked(DaemonManager.prototype.start).mockResolvedValue(mockDaemonInfo);

      const result = await runWatchCommand(testDir, {
        name: 'test-index',
      });

      // The command should return data, formatting happens in CLI layer
      expect(result.pid).toBe(12345);
      expect(result.indexName).toBe('test-index');
    });
  });

  describe('error handling', () => {
    it('should handle daemon startup failures', async () => {
      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(null);
      vi.mocked(DaemonManager.prototype.start).mockRejectedValue(
        new Error('Failed to start daemon')
      );

      await expect(
        runWatchCommand(testDir, { name: 'test-index' })
      ).rejects.toThrow(/failed to start daemon/i);
    });
  });

  describe('auto-index creation', () => {
    it('should check if index exists before starting watcher', async () => {
      const mockDb = { path: testDir, connection: {}, close: vi.fn() };
      const mockDaemonInfo = {
        indexName: 'test-index',
        pid: 12345,
        rootPath: testDir,
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      // Mock that index already exists
      vi.mocked(openDatabase).mockResolvedValue(mockDb as never);
      vi.mocked(getIndex).mockResolvedValue({
        name: 'test-index',
        metadata: {} as never,
        table: null
      });
      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(null);
      vi.mocked(DaemonManager.prototype.start).mockResolvedValue(mockDaemonInfo);

      await runWatchCommand(testDir, { name: 'test-index' });

      // Should check if index exists
      expect(openDatabase).toHaveBeenCalled();
      expect(getIndex).toHaveBeenCalledWith(mockDb, 'test-index');

      // Should NOT run indexing since index exists
      expect(runIndexCommand).not.toHaveBeenCalled();

      // Should start watcher
      expect(DaemonManager.prototype.start).toHaveBeenCalled();
    });

    it('should create index if it does not exist before starting watcher', async () => {
      const mockDb = { path: testDir, connection: {}, close: vi.fn() };
      const mockDaemonInfo = {
        indexName: 'test-index',
        pid: 12345,
        rootPath: testDir,
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      // Mock that index does NOT exist
      vi.mocked(openDatabase).mockResolvedValue(mockDb as never);
      vi.mocked(getIndex).mockResolvedValue(null);
      vi.mocked(runIndexCommand).mockResolvedValue({
        success: true,
        indexName: 'test-index',
        filesProcessed: 5,
        chunksCreated: 10,
      });
      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(null);
      vi.mocked(DaemonManager.prototype.start).mockResolvedValue(mockDaemonInfo);

      await runWatchCommand(testDir, { name: 'test-index' });

      // Should check if index exists
      expect(openDatabase).toHaveBeenCalled();
      expect(getIndex).toHaveBeenCalledWith(mockDb, 'test-index');

      // Should run indexing since index does NOT exist
      expect(runIndexCommand).toHaveBeenCalledWith(testDir, {
        name: 'test-index',
        mode: 'create',
        showProgress: true,
      });

      // Should start watcher
      expect(DaemonManager.prototype.start).toHaveBeenCalled();
    });

    it('should close database connection after checking index', async () => {
      const mockDb = { path: testDir, connection: {}, close: vi.fn() };
      const mockDaemonInfo = {
        indexName: 'test-index',
        pid: 12345,
        rootPath: testDir,
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      vi.mocked(openDatabase).mockResolvedValue(mockDb as never);
      vi.mocked(getIndex).mockResolvedValue({
        name: 'test-index',
        metadata: {} as never,
        table: null
      });
      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(null);
      vi.mocked(DaemonManager.prototype.start).mockResolvedValue(mockDaemonInfo);

      await runWatchCommand(testDir, { name: 'test-index' });

      // Should close database after check
      expect(mockDb.close).toHaveBeenCalled();
    });
  });
});
