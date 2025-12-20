import { openDatabase, getIndex } from '../../storage/lance.js';
import { getDependencies } from '../../storage/code-intel.js';
import { getDbPath } from '../utils/paths.js';
import { createSpinner } from '../utils/progress.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';

/**
 * Options for the deps command.
 */
export interface DepsOptions {
  index?: string;
  showProgress?: boolean;
  json?: boolean;
}

/**
 * A single dependent of a module.
 */
export interface Dependent {
  file: string;
  imports: string[];
  line: number;
}

/**
 * Result of the deps command.
 */
export interface DepsCommandResult {
  success: boolean;
  module: string;
  indexName: string;
  dependents?: Dependent[];
  count: number;
  error?: string;
}

/**
 * Run the deps command.
 *
 * @param module - The module to find dependents for
 * @param options - Command options
 * @returns Dependents results
 */
export async function runDepsCommand(
  module: string,
  options: DepsOptions = {}
): Promise<DepsCommandResult> {
  const showProgress = options.showProgress ?? true;

  // Create spinner if progress is enabled (but not in JSON mode)
  const spinner = showProgress && !options.json ? createSpinner('Initializing...') : null;

  try {
    spinner?.start();

    // Auto-detect index if not provided
    let indexName: string;
    if (options.index) {
      indexName = options.index;
    } else {
      spinner?.update('Auto-detecting index for current directory...');
      const detected = await detectIndexForDirectory();
      if (!detected) {
        throw new Error(
          'No index found for current directory. Either:\n' +
          '  1. Use --index <name> to specify an index\n' +
          '  2. Run `lgrep index .` to index the current directory\n' +
          '  3. Navigate to an indexed directory'
        );
      }
      indexName = detected;
      spinner?.update(`Using auto-detected index "${indexName}"...`);
    }

    // Open database
    spinner?.update('Opening database...');
    const dbPath = getDbPath();
    const db = await openDatabase(dbPath);

    try {
      // Get the index
      spinner?.update(`Loading index "${indexName}"...`);
      const handle = await getIndex(db, indexName);
      if (!handle) {
        throw new Error(`Index "${indexName}" not found`);
      }

      spinner?.update(`Finding dependents of "${module}"...`);

      // Get all dependencies
      const allDeps = await getDependencies(db, indexName, { external: false });

      // Find dependencies that target this module
      const dependents: Dependent[] = [];
      const moduleNormalized = module.replace(/\\/g, '/');

      for (const dep of allDeps) {
        // Check if this dependency targets the module
        const targetNormalized = dep.targetModule.replace(/\\/g, '/');
        const resolvedNormalized = dep.resolvedPath?.replace(/\\/g, '/');

        // Check for exact match or if the resolved path ends with the module
        const matchesTarget = targetNormalized === moduleNormalized ||
                             targetNormalized.endsWith('/' + moduleNormalized) ||
                             targetNormalized.endsWith(moduleNormalized);

        const matchesResolved = resolvedNormalized &&
                               (resolvedNormalized === moduleNormalized ||
                                resolvedNormalized.endsWith('/' + moduleNormalized) ||
                                resolvedNormalized.endsWith(moduleNormalized));

        if (matchesTarget || matchesResolved) {
          // Extract imported names
          const imports = dep.names.length > 0
            ? dep.names.map(n => n.alias || n.name)
            : ['*'];

          dependents.push({
            file: dep.sourceFile,
            imports,
            line: dep.line,
          });
        }
      }

      spinner?.succeed(`Found ${dependents.length} dependent(s) of "${module}"`);

      return {
        success: true,
        module,
        indexName,
        dependents,
        count: dependents.length,
      };
    } finally {
      await db.close();
    }
  } catch (err) {
    spinner?.fail('Command failed');
    throw err;
  }
}
