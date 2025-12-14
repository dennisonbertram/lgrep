import chokidar, { type FSWatcher } from 'chokidar';
import { shouldExclude, DEFAULT_EXCLUDES, DEFAULT_SECRET_EXCLUDES } from './walker.js';
import { basename } from 'node:path';

/**
 * Options for creating a file watcher.
 */
export interface WatcherOptions {
  /** Patterns to exclude (directories and files) */
  excludes?: string[];
  /** Debounce time in milliseconds (default: 500) */
  debounceMs?: number;
}

/**
 * Represents a file change event.
 */
export interface FileChange {
  /** Path to the changed file */
  path: string;
  /** Type of change */
  type: 'add' | 'change' | 'unlink';
}

/**
 * Event handlers for watcher events.
 */
type ChangeHandler = (changes: FileChange[]) => void;
type ErrorHandler = (error: Error) => void;
type ReadyHandler = () => void;

/**
 * File watcher interface.
 */
export interface Watcher {
  /** Register event handlers */
  on(event: 'changes', handler: ChangeHandler): void;
  on(event: 'error', handler: ErrorHandler): void;
  on(event: 'ready', handler: ReadyHandler): void;
  /** Close the watcher */
  close(): Promise<void>;
}

/**
 * Create a file watcher for a directory.
 */
export function createWatcher(
  rootPath: string,
  options: WatcherOptions = {}
): Watcher {
  const { excludes = DEFAULT_EXCLUDES, debounceMs = 500 } = options;

  // Combine default excludes with provided excludes
  const allExcludes = [...DEFAULT_EXCLUDES, ...DEFAULT_SECRET_EXCLUDES, ...excludes];

  // Remove duplicates
  const uniqueExcludes = Array.from(new Set(allExcludes));

  // Event handlers
  const changeHandlers: ChangeHandler[] = [];
  const errorHandlers: ErrorHandler[] = [];
  const readyHandlers: ReadyHandler[] = [];

  // Batched changes
  let pendingChanges: FileChange[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;

  // Function to flush pending changes
  const flushChanges = (): void => {
    if (pendingChanges.length === 0) {
      return;
    }

    const changes = [...pendingChanges];
    pendingChanges = [];

    // Emit to all handlers
    for (const handler of changeHandlers) {
      handler(changes);
    }
  };

  // Function to add a change and schedule flush
  const addChange = (change: FileChange): void => {
    pendingChanges.push(change);

    // Clear existing timer
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    // Schedule flush
    debounceTimer = setTimeout(flushChanges, debounceMs);
  };

  // Create chokidar watcher
  const fsWatcher: FSWatcher = chokidar.watch(rootPath, {
    ignored: (path: string, stats?: { isDirectory: () => boolean }): boolean => {
      // Don't ignore the root path itself
      if (path === rootPath) {
        return false;
      }

      // Get the basename for pattern matching
      const name = basename(path);

      // Check if it should be excluded
      return shouldExclude(name, uniqueExcludes);
    },
    persistent: true,
    ignoreInitial: true, // Don't emit events for initial scan
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  // Set up event handlers
  fsWatcher
    .on('add', (path) => {
      addChange({ path, type: 'add' });
    })
    .on('change', (path) => {
      addChange({ path, type: 'change' });
    })
    .on('unlink', (path) => {
      addChange({ path, type: 'unlink' });
    })
    .on('error', (error: unknown) => {
      // Ensure error is an Error instance
      const err = error instanceof Error ? error : new Error(String(error));
      for (const handler of errorHandlers) {
        handler(err);
      }
    })
    .on('ready', () => {
      for (const handler of readyHandlers) {
        handler();
      }
    });

  // Return watcher interface
  return {
    on(event: 'changes' | 'error' | 'ready', handler: ChangeHandler | ErrorHandler | ReadyHandler): void {
      if (event === 'changes') {
        changeHandlers.push(handler as ChangeHandler);
      } else if (event === 'error') {
        errorHandlers.push(handler as ErrorHandler);
      } else if (event === 'ready') {
        readyHandlers.push(handler as ReadyHandler);
      }
    },

    async close(): Promise<void> {
      // Flush any pending changes before closing
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        flushChanges();
      }

      await fsWatcher.close();
    },
  };
}
