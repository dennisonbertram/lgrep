import { openDatabase, getIndex } from '../../storage/lance.js';
import { getDependencies } from '../../storage/code-intel.js';
import { getDbPath } from '../utils/paths.js';
import type { CodeDependency } from '../../types/code-intel.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { createSpinner } from '../utils/progress.js';

/**
 * Options for cycles command.
 */
export interface CyclesOptions {
  index?: string;
  json?: boolean;
  showProgress?: boolean;
}

/**
 * Result of cycles detection.
 */
export interface CyclesResult {
  success: boolean;
  indexName: string;
  cycles: string[][];
  inspected: number;
}

const MAX_CYCLE_LENGTH = 16;

export async function runCyclesCommand(
  options: CyclesOptions = {}
): Promise<CyclesResult> {
  const showProgress = options.showProgress ?? true;
  const spinner = showProgress && !options.json ? createSpinner('Scanning dependencies...') : null;
  spinner?.start();

  try {
    let indexName: string;
    if (options.index) {
      indexName = options.index;
    } else {
      spinner?.update('Auto-detecting index...');
      const detected = await detectIndexForDirectory();
      if (!detected) {
        throw new Error('No index found for current directory.');
      }
      indexName = detected;
      spinner?.update(`Using index "${indexName}"`);
    }

    spinner?.update('Opening database...');
    const dbPath = getDbPath();
    const db = await openDatabase(dbPath);

    try {
      spinner?.update('Loading dependencies...');
      const handle = await getIndex(db, indexName);
      if (!handle) {
        throw new Error(`Index "${indexName}" not found`);
      }

      const dependencies = await getDependencies(db, indexName);
      const graph = buildGraph(dependencies);

      const cycles = detectCycles(graph);

      spinner?.succeed(`Found ${cycles.length} cycle(s)`);

      return {
        success: true,
        indexName,
        cycles,
        inspected: dependencies.length,
      };
    } finally {
      await db.close();
    }
  } catch (error) {
    spinner?.fail('Cycles detection failed');
    throw error;
  }
}

function buildGraph(dependencies: CodeDependency[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const dep of dependencies) {
    if (!dep.resolvedPath) continue;

    const sources = graph.get(dep.sourceFile) ?? new Set<string>();
    sources.add(dep.resolvedPath);
    graph.set(dep.sourceFile, sources);
  }

  return graph;
}

function detectCycles(graph: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const seenCycles = new Set<string>();

  const nodes = Array.from(graph.keys());

  for (const node of nodes) {
    dfs(node);
  }

  return cycles;

  function dfs(node: string): void {
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    stack.push(node);
    onStack.add(node);

    const neighbors = graph.get(node) ?? new Set<string>();

    for (const neighbor of neighbors) {
      if (onStack.has(neighbor)) {
        const cycleStart = stack.indexOf(neighbor);
        if (cycleStart >= 0) {
          const cycle = stack.slice(cycleStart).concat(neighbor);
          if (cycle.length <= MAX_CYCLE_LENGTH) {
            const normalized = cycle.join('->');
            if (!seenCycles.has(normalized)) {
              seenCycles.add(normalized);
              cycles.push(cycle);
            }
          }
        }
        continue;
      }

      dfs(neighbor);
    }

    stack.pop();
    onStack.delete(node);
  }
}
