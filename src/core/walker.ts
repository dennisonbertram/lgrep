import { readdir, stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import ignore, { type Ignore } from 'ignore';

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
  /** Whether to respect .gitignore files (default: true) */
  respectGitignore?: boolean;
  /** Whether to respect .lgrepignore files (default: true) */
  respectLgrepignore?: boolean;
}

/**
 * Default directories and file patterns to exclude.
 *
 * NOTE FOR LLMs: These defaults are intentionally aggressive to prevent index bloat.
 * If you need to index something that's excluded by default, users can:
 * 1. Create a .lgrepignore file with negation patterns (e.g., !.vscode/)
 * 2. Use `lgrep config excludes` to customize the exclude list
 * 3. Pass --no-default-excludes flag to indexing commands
 */
export const DEFAULT_EXCLUDES: string[] = [
  // ===================
  // VERSION CONTROL
  // ===================
  '.git',
  '.hg',
  '.svn',
  '.bzr',
  '_darcs',
  '.fossil',

  // ===================
  // DEPENDENCIES
  // ===================
  // JavaScript/Node
  'node_modules',
  '.pnpm-store',
  '.yarn',
  'bower_components',
  'jspm_packages',
  '.npm',

  // Python
  '.venv',
  'venv',
  'env',
  '.env',
  '__pycache__',
  '*.egg-info',
  '.eggs',
  'eggs',
  'site-packages',
  '.python-version',

  // Ruby
  'vendor',
  '.bundle',

  // Go
  'vendor',

  // Rust
  '.cargo',

  // Java/JVM
  '.gradle',
  '.m2',
  '.maven',

  // .NET
  'packages',

  // Deno
  '.deno',

  // ===================
  // BUILD OUTPUTS
  // ===================
  'dist',
  'build',
  'target',
  'out',
  'output',
  '_build',
  'bin',
  'obj',

  // Frontend frameworks
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.vercel',
  '.netlify',
  '.amplify',

  // ===================
  // CACHES
  // ===================
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.nx',
  '.rush',
  '.angular',
  '.sass-cache',
  '.eslintcache',
  '.stylelintcache',
  '.prettiercache',

  // Python caches
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
  '.hypothesis',

  // ===================
  // TEST/COVERAGE
  // ===================
  'coverage',
  '.nyc_output',
  'htmlcov',
  'test-results',
  'playwright-report',
  '.playwright',
  '*.lcov',

  // ===================
  // IDE/EDITOR
  // ===================
  '.idea',
  '.vscode',
  '*.swp',
  '*.swo',
  '*.swn',
  '*~',
  '*.bak',
  '.project',
  '.classpath',
  '.settings',
  '*.sublime-*',

  // ===================
  // SYSTEM FILES
  // ===================
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '*.pid',
  '*.seed',

  // ===================
  // MINIFIED/BUNDLED
  // ===================
  '*.min.js',
  '*.min.css',
  '*.bundle.js',
  '*.chunk.js',

  // ===================
  // SOURCE MAPS
  // ===================
  '*.map',
  '*.js.map',
  '*.css.map',
  '*.d.ts.map',

  // ===================
  // LOCK FILES
  // ===================
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Gemfile.lock',
  'poetry.lock',
  'Cargo.lock',
  'composer.lock',
  'Pipfile.lock',
  'mix.lock',
  'pubspec.lock',
  'go.sum',
  'flake.lock',

  // ===================
  // LOG FILES
  // ===================
  '*.log',
  'logs',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',
  'lerna-debug.log*',

  // ===================
  // COMPILED/GENERATED
  // ===================
  '*.pyc',
  '*.pyo',
  '*.pyd',
  '*.o',
  '*.obj',
  '*.a',
  '*.lib',
  '*.class',
  '*.jar',
  '*.war',
  '*.ear',
  '*.dSYM',
  '*.orig',
  '*.rej',

  // ===================
  // TEMPORARY
  // ===================
  'tmp',
  'temp',
  '.tmp',
  '.temp',
  '*.tmp',
  '*.temp',

  // ===================
  // CONTAINERS/VM
  // ===================
  '.docker',
  '.vagrant',

  // ===================
  // ML/AI ARTIFACTS
  // ===================
  'checkpoints',
  '*.ckpt',
  '*.pt',
  '*.pth',
  '*.h5',
  '*.onnx',
  '*.safetensors',
  '*.pb',
  'mlruns',
  'wandb',

  // ===================
  // CTAGS/GTAGS
  // ===================
  'TAGS',
  'tags',
  'GTAGS',
  'GRTAGS',
  'GPATH',
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
  // ===================
  // IMAGES
  // ===================
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
  '.psd',
  '.ai',
  '.eps',
  '.raw',
  '.cr2',
  '.nef',
  '.heic',
  '.heif',
  '.avif',
  '.jxl',

  // ===================
  // FONTS
  // ===================
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.fon',
  '.fnt',

  // ===================
  // ARCHIVES
  // ===================
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.lz',
  '.lzma',
  '.lzo',
  '.rar',
  '.7z',
  '.cab',
  '.arj',
  '.z',
  '.zst',
  '.dmg',
  '.iso',
  '.img',

  // ===================
  // DOCUMENTS (BINARY)
  // ===================
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.pages',
  '.numbers',
  '.key',
  '.epub',
  '.mobi',

  // ===================
  // AUDIO
  // ===================
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.wma',
  '.aiff',
  '.opus',
  '.mid',
  '.midi',

  // ===================
  // VIDEO
  // ===================
  '.mp4',
  '.webm',
  '.avi',
  '.mov',
  '.mkv',
  '.flv',
  '.wmv',
  '.m4v',
  '.mpeg',
  '.mpg',
  '.3gp',
  '.ogv',

  // ===================
  // EXECUTABLES/LIBRARIES
  // ===================
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.app',
  '.msi',
  '.deb',
  '.rpm',
  '.apk',
  '.ipa',
  '.com',
  '.bat',
  '.sys',
  '.drv',

  // ===================
  // DATABASE
  // ===================
  '.db',
  '.sqlite',
  '.sqlite3',
  '.mdb',
  '.accdb',
  '.frm',
  '.ibd',
  '.ldf',
  '.mdf',

  // ===================
  // 3D/CAD
  // ===================
  '.obj',
  '.fbx',
  '.blend',
  '.3ds',
  '.dae',
  '.stl',
  '.gltf',
  '.glb',
  '.usdz',
  '.dwg',
  '.dxf',

  // ===================
  // GAME/ENGINE
  // ===================
  '.unity',
  '.unitypackage',
  '.uasset',
  '.pak',

  // ===================
  // OTHER BINARY
  // ===================
  '.wasm',
  '.node',
  '.pyc',
  '.pyo',
  '.class',
  '.jar',
  '.war',
  '.ear',
  '.rlib',
  '.rmeta',
  '.pdb',
  '.ilk',
  '.nupkg',
  '.vsix',
  '.crx',
  '.xpi',
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
 * Read and parse an ignore file (.gitignore or .lgrepignore).
 * Returns the patterns as an array of strings.
 */
async function readIgnoreFile(filePath: string): Promise<string[]> {
  try {
    if (!existsSync(filePath)) {
      return [];
    }
    const content = await readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Create an ignore instance from gitignore and lgrepignore files.
 */
async function createIgnoreFilter(
  rootPath: string,
  options: { respectGitignore?: boolean; respectLgrepignore?: boolean }
): Promise<Ignore> {
  const ig = ignore();

  // Add .gitignore patterns
  if (options.respectGitignore !== false) {
    const gitignorePath = join(rootPath, '.gitignore');
    const gitignorePatterns = await readIgnoreFile(gitignorePath);
    if (gitignorePatterns.length > 0) {
      ig.add(gitignorePatterns);
    }
  }

  // Add .lgrepignore patterns (these take precedence / are added after)
  if (options.respectLgrepignore !== false) {
    const lgrepignorePath = join(rootPath, '.lgrepignore');
    const lgrepignorePatterns = await readIgnoreFile(lgrepignorePath);
    if (lgrepignorePatterns.length > 0) {
      ig.add(lgrepignorePatterns);
    }
  }

  return ig;
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
    respectGitignore = true,
    respectLgrepignore = true,
  } = options;

  const allExcludes = [...excludes, ...secretExcludes];
  const results: WalkResult[] = [];

  // Create ignore filter from .gitignore and .lgrepignore
  const ignoreFilter = await createIgnoreFilter(rootPath, {
    respectGitignore,
    respectLgrepignore,
  });

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;
      const fullPath = join(currentPath, name);
      const relativePath = relative(rootPath, fullPath).replace(/\\/g, '/');

      // Skip hidden files/directories unless explicitly included
      if (!includeHidden && name.startsWith('.') && name !== '.') {
        // Allow .gitignore and .lgrepignore to be read, but don't index them
        continue;
      }

      // Check built-in exclude patterns (node_modules, .git, etc.)
      if (shouldExclude(name, allExcludes)) {
        continue;
      }

      // Check gitignore/lgrepignore patterns
      if (ignoreFilter.ignores(relativePath)) {
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
            relativePath: relativePath,
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
