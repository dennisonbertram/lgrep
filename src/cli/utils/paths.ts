import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Get the lgrep home directory based on platform conventions.
 *
 * Priority:
 * 1. LGREP_HOME environment variable (override)
 * 2. Platform-specific:
 *    - Linux: $XDG_DATA_HOME/lgrep or ~/.local/share/lgrep
 *    - macOS: ~/Library/Application Support/lgrep
 *    - Windows: %APPDATA%/lgrep
 */
export function getLgrepHome(): string {
  // Allow override via environment variable
  const envHome = process.env['LGREP_HOME'];
  if (envHome) {
    return envHome;
  }

  const platform = process.platform;
  const home = homedir();

  switch (platform) {
    case 'darwin':
      // macOS: ~/Library/Application Support/lgrep
      return join(home, 'Library', 'Application Support', 'lgrep');

    case 'win32':
      // Windows: %APPDATA%/lgrep
      const appData = process.env['APPDATA'];
      if (appData) {
        return join(appData, 'lgrep');
      }
      // Fallback for Windows if APPDATA not set
      return join(home, 'AppData', 'Roaming', 'lgrep');

    default:
      // Linux and others: XDG_DATA_HOME or ~/.local/share
      const xdgDataHome = process.env['XDG_DATA_HOME'];
      if (xdgDataHome) {
        return join(xdgDataHome, 'lgrep');
      }
      return join(home, '.local', 'share', 'lgrep');
  }
}

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
