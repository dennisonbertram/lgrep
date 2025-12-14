import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Get the mgrep home directory based on platform conventions.
 *
 * Priority:
 * 1. MGREP_HOME environment variable (override)
 * 2. Platform-specific:
 *    - Linux: $XDG_DATA_HOME/mgrep or ~/.local/share/mgrep
 *    - macOS: ~/Library/Application Support/mgrep
 *    - Windows: %APPDATA%/mgrep
 */
export function getMgrepHome(): string {
  // Allow override via environment variable
  const envHome = process.env['MGREP_HOME'];
  if (envHome) {
    return envHome;
  }

  const platform = process.platform;
  const home = homedir();

  switch (platform) {
    case 'darwin':
      // macOS: ~/Library/Application Support/mgrep
      return join(home, 'Library', 'Application Support', 'mgrep');

    case 'win32':
      // Windows: %APPDATA%/mgrep
      const appData = process.env['APPDATA'];
      if (appData) {
        return join(appData, 'mgrep');
      }
      // Fallback for Windows if APPDATA not set
      return join(home, 'AppData', 'Roaming', 'mgrep');

    default:
      // Linux and others: XDG_DATA_HOME or ~/.local/share
      const xdgDataHome = process.env['XDG_DATA_HOME'];
      if (xdgDataHome) {
        return join(xdgDataHome, 'mgrep');
      }
      return join(home, '.local', 'share', 'mgrep');
  }
}

/**
 * Get the path to the database directory.
 */
export function getDbPath(): string {
  return join(getMgrepHome(), 'db');
}

/**
 * Get the path to the config file.
 */
export function getConfigPath(): string {
  return join(getMgrepHome(), 'config.json');
}

/**
 * Get the path to the cache directory.
 */
export function getCachePath(): string {
  return join(getMgrepHome(), 'cache');
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
