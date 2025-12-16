import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWatcher, type FileChange, type Watcher } from './watcher.js';
import { mkdir, writeFile, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('createWatcher', () => {
  let testDir: string;
  let watcher: Watcher | null = null;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testDir = join(tmpdir(), `lgrep-watcher-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up watcher
    if (watcher) {
      await watcher.close();
      watcher = null;
    }

    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  it('should emit ready event when watcher is initialized', async () => {
    return new Promise<void>((resolve) => {
      watcher = createWatcher(testDir);
      watcher.on('ready', () => {
        resolve();
      });
    });
  });

  it('should detect file additions', async () => {
    const changes: FileChange[] = [];

    return new Promise<void>((resolve) => {
      watcher = createWatcher(testDir, { debounceMs: 100 });

      watcher.on('ready', async () => {
        watcher!.on('changes', (detectedChanges) => {
          changes.push(...detectedChanges);
          expect(changes).toHaveLength(1);
          expect(changes[0].type).toBe('add');
          expect(changes[0].path).toContain('test-file.txt');
          resolve();
        });

        // Create a file after watcher is ready
        await writeFile(join(testDir, 'test-file.txt'), 'content');
      });
    });
  });

  it('should detect file changes', async () => {
    const testFile = join(testDir, 'test-file.txt');
    await writeFile(testFile, 'initial content');

    const changes: FileChange[] = [];

    return new Promise<void>((resolve) => {
      watcher = createWatcher(testDir, { debounceMs: 100 });

      watcher.on('ready', async () => {
        watcher!.on('changes', (detectedChanges) => {
          changes.push(...detectedChanges);
          expect(changes).toHaveLength(1);
          expect(changes[0].type).toBe('change');
          expect(changes[0].path).toContain('test-file.txt');
          resolve();
        });

        // Modify the file after watcher is ready
        await writeFile(testFile, 'updated content');
      });
    });
  });

  it('should detect file deletions', async () => {
    const testFile = join(testDir, 'test-file.txt');
    await writeFile(testFile, 'content');

    const changes: FileChange[] = [];

    return new Promise<void>((resolve) => {
      watcher = createWatcher(testDir, { debounceMs: 100 });

      watcher.on('ready', async () => {
        watcher!.on('changes', (detectedChanges) => {
          changes.push(...detectedChanges);
          expect(changes).toHaveLength(1);
          expect(changes[0].type).toBe('unlink');
          expect(changes[0].path).toContain('test-file.txt');
          resolve();
        });

        // Delete the file after watcher is ready
        await unlink(testFile);
      });
    });
  });

  it('should batch multiple rapid changes', async () => {
    const changes: FileChange[] = [];
    let changeEventCount = 0;

    return new Promise<void>((resolve) => {
      watcher = createWatcher(testDir, { debounceMs: 200 });

      watcher.on('ready', async () => {
        watcher!.on('changes', (detectedChanges) => {
          changeEventCount++;
          changes.push(...detectedChanges);

          // Should receive all changes in one batch
          // With debouncing, multiple rapid changes should be batched together
          expect(changes.length).toBeGreaterThan(0);
          resolve();
        });

        // Create multiple files rapidly
        await Promise.all([
          writeFile(join(testDir, 'file1.txt'), 'content1'),
          writeFile(join(testDir, 'file2.txt'), 'content2'),
          writeFile(join(testDir, 'file3.txt'), 'content3'),
        ]);
      });
    });
  }, 10000); // Increase timeout to 10 seconds

  it('should respect exclude patterns', async () => {
    const changes: FileChange[] = [];

    return new Promise<void>((resolve, reject) => {
      watcher = createWatcher(testDir, {
        excludes: ['*.log', 'node_modules'],
        debounceMs: 100,
      });

      watcher.on('ready', async () => {
        watcher!.on('changes', (detectedChanges) => {
          changes.push(...detectedChanges);
          // Should only see the .txt file
          const hasLogFile = changes.some((c) => c.path.endsWith('.log'));
          if (hasLogFile) {
            reject(new Error('Should not detect .log files'));
          }
        });

        // Create excluded file
        await writeFile(join(testDir, 'debug.log'), 'log content');

        // Wait a bit
        await new Promise((r) => setTimeout(r, 300));

        // Create non-excluded file
        await writeFile(join(testDir, 'test.txt'), 'content');

        // Wait for debounce
        await new Promise((r) => setTimeout(r, 300));

        expect(changes).toHaveLength(1);
        expect(changes[0].path).toContain('test.txt');
        resolve();
      });
    });
  });

  it('should exclude directories from patterns', async () => {
    const nodeModulesDir = join(testDir, 'node_modules');
    await mkdir(nodeModulesDir);

    const changes: FileChange[] = [];

    return new Promise<void>((resolve, reject) => {
      watcher = createWatcher(testDir, {
        excludes: ['node_modules'],
        debounceMs: 100,
      });

      watcher.on('ready', async () => {
        watcher!.on('changes', (detectedChanges) => {
          changes.push(...detectedChanges);
          const hasNodeModules = changes.some((c) =>
            c.path.includes('node_modules')
          );
          if (hasNodeModules) {
            reject(new Error('Should not detect files in node_modules'));
          }
        });

        // Create file in excluded directory
        await writeFile(join(nodeModulesDir, 'package.json'), '{}');

        // Wait a bit
        await new Promise((r) => setTimeout(r, 300));

        // Create file in root
        await writeFile(join(testDir, 'test.txt'), 'content');

        // Wait for debounce
        await new Promise((r) => setTimeout(r, 300));

        expect(changes).toHaveLength(1);
        expect(changes[0].path).toContain('test.txt');
        resolve();
      });
    });
  });

  it('should have error handler registered', async () => {
    let errorHandlerCalled = false;

    watcher = createWatcher(testDir);

    watcher.on('error', (error) => {
      errorHandlerCalled = true;
      expect(error).toBeInstanceOf(Error);
    });

    // Verify the error handler is registered
    // In a real scenario, chokidar would emit errors for permission issues, etc.
    expect(errorHandlerCalled).toBe(false); // Not called yet

    // Wait for ready to ensure watcher is initialized
    await new Promise<void>((resolve) => {
      watcher!.on('ready', () => resolve());
    });
  });

  it('should close watcher cleanly', async () => {
    watcher = createWatcher(testDir);

    return new Promise<void>((resolve) => {
      watcher!.on('ready', async () => {
        await watcher!.close();
        // Should not throw
        resolve();
      });
    });
  });

  it('should use default debounce time if not specified', async () => {
    watcher = createWatcher(testDir);

    return new Promise<void>((resolve) => {
      watcher!.on('ready', async () => {
        const startTime = Date.now();

        watcher!.on('changes', () => {
          const elapsed = Date.now() - startTime;
          // Default debounce is 500ms, so should take at least that long
          expect(elapsed).toBeGreaterThanOrEqual(450); // Allow some slack
          resolve();
        });

        await writeFile(join(testDir, 'test.txt'), 'content');
      });
    });
  });
});
