import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getConfigPath } from '../cli/utils/paths.js';

/**
 * Configuration schema for mgrep.
 */
export interface MgrepConfig {
  /** Default embedding model to use */
  model: string;
  /** Target chunk size in tokens */
  chunkSize: number;
  /** Overlap between chunks in tokens */
  chunkOverlap: number;
  /** Maximum file size to index in bytes */
  maxFileSize: number;
  /** Patterns to exclude from indexing */
  excludes: string[];
  /** Patterns for secret files to exclude */
  secretExcludes: string[];
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: MgrepConfig = {
  model: 'mxbai-embed-large',
  chunkSize: 500,
  chunkOverlap: 50,
  maxFileSize: 5 * 1024 * 1024, // 5MB
  excludes: [
    '.git',
    '.hg',
    '.svn',
    'node_modules',
    'dist',
    'build',
    'target',
    '.venv',
    '__pycache__',
    '.DS_Store',
    '*.min.js',
    '*.min.css',
    '*.lock',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
  ],
  secretExcludes: [
    '.env*',
    '*.pem',
    '*.key',
    'id_rsa*',
    '*.p12',
    'credentials.json',
    '.aws/*',
    '.npmrc',
    '.pypirc',
  ],
};

/**
 * Load configuration from file, merging with defaults.
 */
export async function loadConfig(): Promise<MgrepConfig> {
  const configPath = getConfigPath();

  try {
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<MgrepConfig>;

    // Merge with defaults (parsed values override defaults)
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
    };
  } catch (error) {
    // If file doesn't exist or can't be parsed, return defaults
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { ...DEFAULT_CONFIG };
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Save configuration to file.
 */
export async function saveConfig(config: MgrepConfig): Promise<void> {
  const configPath = getConfigPath();

  // Ensure directory exists
  await mkdir(dirname(configPath), { recursive: true });

  // Write config as pretty JSON
  const content = JSON.stringify(config, null, 2);
  await writeFile(configPath, content, 'utf-8');
}

/**
 * Get a specific configuration value.
 */
export async function getConfigValue<K extends keyof MgrepConfig>(
  key: K
): Promise<MgrepConfig[K]> {
  const config = await loadConfig();
  return config[key];
}

/**
 * Set a specific configuration value.
 */
export async function setConfigValue<K extends keyof MgrepConfig>(
  key: K,
  value: MgrepConfig[K]
): Promise<void> {
  const config = await loadConfig();
  config[key] = value;
  await saveConfig(config);
}

/**
 * Type guard for Node.js errors with code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
