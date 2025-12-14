import { DaemonManager } from '../../daemon/manager.js';

/**
 * Options for the stop command.
 */
export interface StopOptions {
  json?: boolean;
}

/**
 * Result of the stop command.
 */
export interface StopResult {
  success: boolean;
  indexName: string;
  wasStopped: boolean;
  error?: string;
}

/**
 * Run the stop command.
 *
 * @param indexName - Name of the index to stop watching
 * @param options - Stop options
 * @returns Stop result
 */
export async function runStopCommand(
  indexName: string,
  options: StopOptions = {}
): Promise<StopResult> {
  const manager = new DaemonManager();

  // Check if watcher is running
  const status = await manager.status(indexName);
  if (!status) {
    throw new Error(`Watcher for "${indexName}" is not running`);
  }

  // Stop the watcher
  const stopped = await manager.stop(indexName);
  if (!stopped) {
    throw new Error(`Failed to stop watcher for "${indexName}"`);
  }

  return {
    success: true,
    indexName,
    wasStopped: true,
  };
}
