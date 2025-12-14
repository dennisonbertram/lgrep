import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChangeDebouncer, triggerIncrementalIndex } from './worker-logic.js';

describe('ChangeDebouncer', () => {
  let debouncer: ChangeDebouncer;
  let callback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    callback = vi.fn().mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    debouncer?.clear();
    vi.useRealTimers();
  });

  describe('debouncing behavior', () => {
    it('should debounce multiple changes within delay period', async () => {
      debouncer = new ChangeDebouncer(1000, callback);

      // Add changes rapidly
      debouncer.addChange('/path/to/file1.ts');
      debouncer.addChange('/path/to/file2.ts');
      debouncer.addChange('/path/to/file3.ts');

      // Callback should not be called yet
      expect(callback).not.toHaveBeenCalled();
      expect(debouncer.getPendingCount()).toBe(3);

      // Fast-forward time past delay
      await vi.advanceTimersByTimeAsync(1000);

      // Callback should be called once with all files
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith([
        '/path/to/file1.ts',
        '/path/to/file2.ts',
        '/path/to/file3.ts',
      ]);
      expect(debouncer.getPendingCount()).toBe(0);
    });

    it('should reset timer when new changes arrive', async () => {
      debouncer = new ChangeDebouncer(1000, callback);

      // Add first change
      debouncer.addChange('/path/to/file1.ts');

      // Advance time by 500ms (not enough to trigger)
      await vi.advanceTimersByTimeAsync(500);

      // Add another change (resets timer)
      debouncer.addChange('/path/to/file2.ts');

      // Advance another 500ms (still not enough)
      await vi.advanceTimersByTimeAsync(500);
      expect(callback).not.toHaveBeenCalled();

      // Advance final 500ms (now total of 1000ms since last change)
      await vi.advanceTimersByTimeAsync(500);

      // Callback should be called
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith([
        '/path/to/file1.ts',
        '/path/to/file2.ts',
      ]);
    });

    it('should deduplicate same file path', async () => {
      debouncer = new ChangeDebouncer(1000, callback);

      // Add same file multiple times
      debouncer.addChange('/path/to/file.ts');
      debouncer.addChange('/path/to/file.ts');
      debouncer.addChange('/path/to/file.ts');

      expect(debouncer.getPendingCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);

      // Should only process once
      expect(callback).toHaveBeenCalledWith(['/path/to/file.ts']);
    });

    it('should handle different delay values', async () => {
      debouncer = new ChangeDebouncer(2000, callback);

      debouncer.addChange('/path/to/file.ts');

      // 1 second - should not trigger
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).not.toHaveBeenCalled();

      // 2 seconds total - should trigger
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('flush method', () => {
    it('should immediately flush pending changes', async () => {
      debouncer = new ChangeDebouncer(1000, callback);

      debouncer.addChange('/path/to/file1.ts');
      debouncer.addChange('/path/to/file2.ts');

      expect(debouncer.getPendingCount()).toBe(2);

      // Flush immediately without waiting for timer
      await debouncer.flush();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith([
        '/path/to/file1.ts',
        '/path/to/file2.ts',
      ]);
      expect(debouncer.getPendingCount()).toBe(0);
    });

    it('should do nothing when flushing with no pending changes', async () => {
      debouncer = new ChangeDebouncer(1000, callback);

      await debouncer.flush();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should clear timer when flushing', async () => {
      debouncer = new ChangeDebouncer(1000, callback);

      debouncer.addChange('/path/to/file.ts');
      await debouncer.flush();

      // Advance time - callback should not be called again
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear method', () => {
    it('should clear pending changes without calling callback', async () => {
      debouncer = new ChangeDebouncer(1000, callback);

      debouncer.addChange('/path/to/file1.ts');
      debouncer.addChange('/path/to/file2.ts');

      expect(debouncer.getPendingCount()).toBe(2);

      debouncer.clear();

      expect(debouncer.getPendingCount()).toBe(0);
      expect(callback).not.toHaveBeenCalled();

      // Advance time - callback should still not be called
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should propagate errors from callback on flush', async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error('Callback error'));
      debouncer = new ChangeDebouncer(1000, errorCallback);

      debouncer.addChange('/path/to/file.ts');

      await expect(debouncer.flush()).rejects.toThrow('Callback error');
    });
  });

  describe('getPendingCount', () => {
    it('should return correct count of pending changes', () => {
      debouncer = new ChangeDebouncer(1000, callback);

      expect(debouncer.getPendingCount()).toBe(0);

      debouncer.addChange('/path/to/file1.ts');
      expect(debouncer.getPendingCount()).toBe(1);

      debouncer.addChange('/path/to/file2.ts');
      expect(debouncer.getPendingCount()).toBe(2);

      debouncer.addChange('/path/to/file1.ts'); // Duplicate
      expect(debouncer.getPendingCount()).toBe(2);
    });
  });
});

describe('triggerIncrementalIndex', () => {
  // Mock the index command module
  vi.mock('../cli/commands/index.js', () => ({
    runIndexCommand: vi.fn(),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call runIndexCommand with update mode', async () => {
    const { runIndexCommand } = await import('../cli/commands/index.js');
    vi.mocked(runIndexCommand).mockResolvedValue({
      success: true,
      indexName: 'test-index',
      filesProcessed: 5,
      chunksCreated: 10,
      filesUpdated: 3,
      filesSkipped: 2,
    });

    await triggerIncrementalIndex('test-index', '/test/path', ['/test/path/file1.ts']);

    expect(runIndexCommand).toHaveBeenCalledWith('/test/path', {
      name: 'test-index',
      mode: 'update',
      showProgress: false,
    });
  });

  it('should handle indexing errors', async () => {
    const { runIndexCommand } = await import('../cli/commands/index.js');
    vi.mocked(runIndexCommand).mockRejectedValue(new Error('Indexing failed'));

    await expect(
      triggerIncrementalIndex('test-index', '/test/path', ['/test/path/file1.ts'])
    ).rejects.toThrow('Indexing failed');
  });

  it('should work with multiple changed paths', async () => {
    const { runIndexCommand } = await import('../cli/commands/index.js');
    vi.mocked(runIndexCommand).mockResolvedValue({
      success: true,
      indexName: 'test-index',
      filesProcessed: 10,
      chunksCreated: 20,
    });

    const changedPaths = [
      '/test/path/file1.ts',
      '/test/path/file2.ts',
      '/test/path/file3.ts',
    ];

    await triggerIncrementalIndex('test-index', '/test/path', changedPaths);

    expect(runIndexCommand).toHaveBeenCalledTimes(1);
    expect(runIndexCommand).toHaveBeenCalledWith('/test/path', {
      name: 'test-index',
      mode: 'update',
      showProgress: false,
    });
  });
});
