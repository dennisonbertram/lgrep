/**
 * Core logic for the daemon worker process.
 * This module contains testable functions for file watching and incremental indexing.
 */

/**
 * Debounce pending file changes and execute callback.
 * Batches file changes over a specified delay period.
 */
export class ChangeDebouncer {
  private pendingChanges = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private readonly delay: number;
  private readonly callback: (paths: string[]) => Promise<void>;

  constructor(delay: number, callback: (paths: string[]) => Promise<void>) {
    this.delay = delay;
    this.callback = callback;
  }

  /**
   * Add a file path to the pending changes.
   * Resets the debounce timer.
   */
  addChange(path: string): void {
    this.pendingChanges.add(path);

    // Clear existing timer
    if (this.timer) {
      clearTimeout(this.timer);
    }

    // Set new timer
    this.timer = setTimeout(() => {
      this.flush();
    }, this.delay);
  }

  /**
   * Immediately flush all pending changes.
   */
  async flush(): Promise<void> {
    if (this.pendingChanges.size === 0) {
      return;
    }

    const paths = Array.from(this.pendingChanges);
    this.pendingChanges.clear();

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    await this.callback(paths);
  }

  /**
   * Get the count of pending changes.
   */
  getPendingCount(): number {
    return this.pendingChanges.size;
  }

  /**
   * Clear all pending changes without flushing.
   */
  clear(): void {
    this.pendingChanges.clear();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Trigger incremental re-indexing for changed files.
 * This function is called by the worker when file changes are detected.
 *
 * @param indexName - Name of the index to update
 * @param rootPath - Root path being watched
 * @param changedPaths - Array of file paths that changed
 */
export async function triggerIncrementalIndex(
  indexName: string,
  rootPath: string,
  changedPaths: string[]
): Promise<void> {
  // Dynamic import to avoid loading heavy dependencies in worker startup
  const { runIndexCommand } = await import('../cli/commands/index.js');

  console.log(`[${new Date().toISOString()}] Triggering incremental index for ${changedPaths.length} changed files`);

  try {
    await runIndexCommand(rootPath, {
      name: indexName,
      mode: 'update',
      showProgress: false,
    });

    console.log(`[${new Date().toISOString()}] Incremental indexing completed successfully`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Incremental indexing failed:`, error);
    throw error;
  }
}
