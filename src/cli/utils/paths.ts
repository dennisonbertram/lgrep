import { join } from 'node:path';
import { getProfileHome, isExplicitLgrepHome } from './profiles.js';

/**
 * Get the lgrep home directory based on platform conventions.
 *
 * Priority:
 * 1. LGREP_HOME environment variable (override)
 * 2. Active profile home under the platform default lgrep directory
 */
export function getLgrepHome(): string {
  const envHome = process.env['LGREP_HOME'];
  if (envHome) {
    return envHome;
  }

  return getProfileHome();
}

export { isExplicitLgrepHome };

/**
 * Get the path to the database directory.
 */
export function getDbPath(): string {
  return join(getLgrepHome(), 'db');
}

/**
 * Get the path to the config file.
 */
export function getConfigPath(): string {
  return join(getLgrepHome(), 'config.json');
}

/**
 * Get the path to the cache directory.
 */
export function getCachePath(): string {
  return join(getLgrepHome(), 'cache');
}

/**
 * Get the path to a specific index directory.
 */
export function getIndexPath(indexName: string): string {
  return join(getDbPath(), indexName);
}

/**
 * Get the path to an index's metadata file.
 */
export function getIndexMetaPath(indexName: string): string {
  return join(getIndexPath(indexName), 'meta.json');
}
