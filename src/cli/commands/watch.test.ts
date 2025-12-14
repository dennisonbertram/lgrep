import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runWatchCommand } from './watch.js';
import { DaemonManager } from '../../daemon/manager.js';

// Mock the daemon manager class
vi.mock('../../daemon/manager.js', () => {
  const DaemonManager = vi.fn();
  DaemonManager.prototype.start = vi.fn();
  DaemonManager.prototype.status = vi.fn();
  return { DaemonManager };
});

describe('watch command', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `mgrep-watch-cmd-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    // Save and override MGREP_HOME
    originalEnv = { ...process.env };
    process.env['MGREP_HOME'] = testDir;

    // Reset mocks
    vi.clearAllMocks();
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

      expect(result.indexName).toMatch(/mgrep-watch-cmd-test-/);
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
});
