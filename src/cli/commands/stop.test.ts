import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runStopCommand } from './stop.js';
import { DaemonManager } from '../../daemon/manager.js';

// Mock the daemon manager class
vi.mock('../../daemon/manager.js', () => {
  const DaemonManager = vi.fn();
  DaemonManager.prototype.stop = vi.fn();
  DaemonManager.prototype.status = vi.fn();
  return { DaemonManager };
});

describe('stop command', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-stop-cmd-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    // Save and override LGREP_HOME
    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
  });

  describe('basic functionality', () => {
    it('should stop a running watcher', async () => {
      const mockDaemonInfo = {
        indexName: 'test-index',
        pid: 12345,
        rootPath: '/some/path',
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(mockDaemonInfo);
      vi.mocked(DaemonManager.prototype.stop).mockResolvedValue(true);

      const result = await runStopCommand('test-index');

      expect(result.success).toBe(true);
      expect(result.indexName).toBe('test-index');
      expect(result.wasStopped).toBe(true);
    });

    it('should handle non-running watcher', async () => {
      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(null);

      await expect(runStopCommand('test-index')).rejects.toThrow(
        /not running/i
      );
    });

    it('should handle stop failures gracefully', async () => {
      const mockDaemonInfo = {
        indexName: 'test-index',
        pid: 12345,
        rootPath: '/some/path',
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(mockDaemonInfo);
      vi.mocked(DaemonManager.prototype.stop).mockResolvedValue(false);

      await expect(runStopCommand('test-index')).rejects.toThrow(
        /failed to stop/i
      );
    });
  });

  describe('JSON output', () => {
    it('should return structured JSON data', async () => {
      const mockDaemonInfo = {
        indexName: 'test-index',
        pid: 12345,
        rootPath: '/some/path',
        startedAt: '2024-01-01T00:00:00Z',
        status: 'running' as const,
      };

      vi.mocked(DaemonManager.prototype.status).mockResolvedValue(mockDaemonInfo);
      vi.mocked(DaemonManager.prototype.stop).mockResolvedValue(true);

      const result = await runStopCommand('test-index', { json: true });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('indexName');
      expect(result).toHaveProperty('wasStopped');
    });
  });

  describe('error handling', () => {
    it('should handle daemon errors', async () => {
      vi.mocked(DaemonManager.prototype.status).mockRejectedValue(
        new Error('Daemon error')
      );

      await expect(runStopCommand('test-index')).rejects.toThrow(
        /daemon error/i
      );
    });
  });
});
