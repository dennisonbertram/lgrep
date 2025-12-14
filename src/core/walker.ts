import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname, basename } from 'node:path';

/**
 * Result from walking a single file.
 */
export interface WalkResult {
  /** Absolute path to the file */
  absolutePath: string;
  /** Path relative to the walk root */
  relativePath: string;
  /** File size in bytes */
  size: number;
  /** File extension (including dot) */
  extension: string;
}

/**
 * Options for file walking.
 */
export interface WalkOptions {
  /** Patterns to exclude (directories and files) */
  excludes?: string[];
  /** Secret file patterns to exclude */
  secretExcludes?: string[];
  /** Maximum file size in bytes */
  maxFileSize?: number;
  /** Whether to include hidden files (default: false) */
  includeHidden?: boolean;
}

/**
 * Default directories and file patterns to exclude.
 */
export const DEFAULT_EXCLUDES: string[] = [
  // Version control
  '.git',
  '.hg',
  '.svn',

  // Dependencies
  'node_modules',
  '.venv',
  '__pycache__',
  'vendor',

  // Build outputs
  'dist',
  'build',
  'target',
  'out',
  '.next',
  '.nuxt',

  // System files
  '.DS_Store',
  'Thumbs.db',

  // Minified files
  '*.min.js',
  '*.min.css',

  // Lock files
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Gemfile.lock',
  'poetry.lock',
  'Cargo.lock',

  // Compiled files
  '*.pyc',
  '*.pyo',
  '*.o',
  '*.obj',
  '*.class',
];

/**
 * Default patterns for secret/sensitive files to exclude.
 */
export const DEFAULT_SECRET_EXCLUDES: string[] = [
  '.env*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa*',
  'id_ed25519*',
  'id_ecdsa*',
  'id_dsa*',
  'credentials.json',
  'secrets.json',
  '.aws/*',
  '.npmrc',
  '.pypirc',
  '.netrc',
];

/**
 * Binary file extensions to skip.
 */
const BINARY_EXTENSIONS = new Set([
  // Images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.svg',
  '.tiff',
  '.tif',

  // Fonts
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',

  // Archives
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.rar',
  '.7z',

  // Documents (binary)
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',

  // Media
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.avi',
  '.mov',
  '.flac',

  // Executables
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',

  // Database
  '.db',
  '.sqlite',
  '.sqlite3',

  // Other binary
  '.wasm',
  '.node',
]);

/**
 * Check if a file is likely binary based on extension.
 */
export function isBinaryFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Check if a path should be excluded based on patterns.
 */
export function shouldExclude(name: string, excludes: string[]): boolean {
  for (const pattern of excludes) {
    // Exact match
    if (name === pattern) {
      return true;
    }

    // Glob pattern matching
    if (pattern.includes('*')) {
      const regex = globToRegex(pattern);
      if (regex.test(name)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Convert a simple glob pattern to a regex.
 */
function globToRegex(pattern: string): RegExp {
  // Escape special regex characters except *
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  // Anchor the pattern
  return new RegExp(`^${regexStr}$`);
}

/**
 * Walk a directory and find all files.
 */
export async function walkFiles(
  rootPath: string,
  options: WalkOptions = {}
): Promise<WalkResult[]> {
  const {
    excludes = DEFAULT_EXCLUDES,
    secretExcludes = DEFAULT_SECRET_EXCLUDES,
    maxFileSize = Infinity,
    includeHidden = false,
  } = options;

  const allExcludes = [...excludes, ...secretExcludes];
  const results: WalkResult[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;
      const fullPath = join(currentPath, name);
      const relativePath = relative(rootPath, fullPath);

      // Skip hidden files/directories unless explicitly included
      if (!includeHidden && name.startsWith('.') && name !== '.') {
        // Still check if it matches a pattern we want to exclude explicitly
        if (shouldExclude(name, allExcludes)) {
          continue;
        }
        // Check if it's a secret file
        if (shouldExclude(name, secretExcludes)) {
          continue;
        }
      }

      // Check exclude patterns
      if (shouldExclude(name, allExcludes)) {
        continue;
      }

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        await walk(fullPath);
      } else if (entry.isFile()) {
        // Skip binary files
        if (isBinaryFile(name)) {
          continue;
        }

        // Check file size
        try {
          const stats = await stat(fullPath);
          if (stats.size > maxFileSize) {
            continue;
          }

          results.push({
            absolutePath: fullPath,
            relativePath: relativePath.replace(/\\/g, '/'), // Normalize to forward slashes
            size: stats.size,
            extension: extname(name),
          });
        } catch {
          // Skip files we can't stat
          continue;
        }
      }
    }
  }

  await walk(rootPath);
  return results;
}
