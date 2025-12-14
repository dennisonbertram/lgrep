import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  walkFiles,
  shouldExclude,
  isBinaryFile,
  DEFAULT_EXCLUDES,
  DEFAULT_SECRET_EXCLUDES,
  type WalkOptions,
  type WalkResult,
} from './walker.js';

describe('file walker', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `mgrep-walker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('DEFAULT_EXCLUDES', () => {
    it('should include common directories to skip', () => {
      expect(DEFAULT_EXCLUDES).toContain('.git');
      expect(DEFAULT_EXCLUDES).toContain('node_modules');
      expect(DEFAULT_EXCLUDES).toContain('dist');
      expect(DEFAULT_EXCLUDES).toContain('build');
    });

    it('should include lock files', () => {
      expect(DEFAULT_EXCLUDES).toContain('package-lock.json');
      expect(DEFAULT_EXCLUDES).toContain('yarn.lock');
    });
  });

  describe('DEFAULT_SECRET_EXCLUDES', () => {
    it('should include common secret file patterns', () => {
      expect(DEFAULT_SECRET_EXCLUDES).toContain('.env*');
      expect(DEFAULT_SECRET_EXCLUDES).toContain('*.pem');
      expect(DEFAULT_SECRET_EXCLUDES).toContain('id_rsa*');
    });
  });

  describe('shouldExclude', () => {
    const excludes = ['.git', 'node_modules', '*.lock', '*.min.js'];

    it('should exclude exact matches', () => {
      expect(shouldExclude('.git', excludes)).toBe(true);
      expect(shouldExclude('node_modules', excludes)).toBe(true);
    });

    it('should exclude glob patterns', () => {
      expect(shouldExclude('package-lock.json', ['*.lock'])).toBe(false); // *.lock doesn't match package-lock.json
      expect(shouldExclude('yarn.lock', excludes)).toBe(true);
      expect(shouldExclude('app.min.js', excludes)).toBe(true);
    });

    it('should not exclude non-matching files', () => {
      expect(shouldExclude('src', excludes)).toBe(false);
      expect(shouldExclude('index.ts', excludes)).toBe(false);
    });

    it('should handle patterns with wildcards', () => {
      expect(shouldExclude('.env', ['.env*'])).toBe(true);
      expect(shouldExclude('.env.local', ['.env*'])).toBe(true);
      expect(shouldExclude('.envrc', ['.env*'])).toBe(true);
    });
  });

  describe('isBinaryFile', () => {
    it('should detect binary extensions', () => {
      expect(isBinaryFile('image.png')).toBe(true);
      expect(isBinaryFile('photo.jpg')).toBe(true);
      expect(isBinaryFile('icon.ico')).toBe(true);
      expect(isBinaryFile('font.woff')).toBe(true);
    });

    it('should not flag text files as binary', () => {
      expect(isBinaryFile('code.ts')).toBe(false);
      expect(isBinaryFile('readme.md')).toBe(false);
      expect(isBinaryFile('config.json')).toBe(false);
    });
  });

  describe('walkFiles', () => {
    it('should find files in a directory', async () => {
      // Create test files
      await writeFile(join(testDir, 'file1.ts'), 'content 1');
      await writeFile(join(testDir, 'file2.js'), 'content 2');

      const results = await walkFiles(testDir);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.relativePath).sort()).toEqual(['file1.ts', 'file2.js']);
    });

    it('should recursively find files in subdirectories', async () => {
      // Create nested structure
      await mkdir(join(testDir, 'src', 'utils'), { recursive: true });
      await writeFile(join(testDir, 'index.ts'), 'root');
      await writeFile(join(testDir, 'src', 'main.ts'), 'main');
      await writeFile(join(testDir, 'src', 'utils', 'helper.ts'), 'helper');

      const results = await walkFiles(testDir);

      expect(results).toHaveLength(3);
      const paths = results.map((r) => r.relativePath).sort();
      expect(paths).toContain('index.ts');
      expect(paths).toContain('src/main.ts');
      expect(paths).toContain('src/utils/helper.ts');
    });

    it('should exclude default directories', async () => {
      // Create files in excluded directories
      await mkdir(join(testDir, 'node_modules'), { recursive: true });
      await mkdir(join(testDir, '.git'), { recursive: true });
      await mkdir(join(testDir, 'src'), { recursive: true });

      await writeFile(join(testDir, 'index.ts'), 'root');
      await writeFile(join(testDir, 'node_modules', 'pkg.js'), 'pkg');
      await writeFile(join(testDir, '.git', 'config'), 'config');
      await writeFile(join(testDir, 'src', 'main.ts'), 'main');

      const results = await walkFiles(testDir);

      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain('index.ts');
      expect(paths).toContain('src/main.ts');
      expect(paths).not.toContain('node_modules/pkg.js');
      expect(paths).not.toContain('.git/config');
    });

    it('should exclude files matching patterns', async () => {
      await writeFile(join(testDir, 'app.ts'), 'app');
      await writeFile(join(testDir, 'app.min.js'), 'minified');
      await writeFile(join(testDir, 'yarn.lock'), 'lock');

      const results = await walkFiles(testDir);

      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain('app.ts');
      expect(paths).not.toContain('app.min.js');
      expect(paths).not.toContain('yarn.lock');
    });

    it('should exclude binary files', async () => {
      await writeFile(join(testDir, 'code.ts'), 'code');
      await writeFile(join(testDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      await writeFile(join(testDir, 'font.woff'), 'font data');

      const results = await walkFiles(testDir);

      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain('code.ts');
      expect(paths).not.toContain('image.png');
      expect(paths).not.toContain('font.woff');
    });

    it('should respect maxFileSize option', async () => {
      await writeFile(join(testDir, 'small.ts'), 'small');
      await writeFile(join(testDir, 'large.ts'), 'x'.repeat(1000));

      const results = await walkFiles(testDir, { maxFileSize: 100 });

      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain('small.ts');
      expect(paths).not.toContain('large.ts');
    });

    it('should include file metadata', async () => {
      await writeFile(join(testDir, 'test.ts'), 'test content');

      const results = await walkFiles(testDir);

      expect(results).toHaveLength(1);
      const result = results[0]!;
      expect(result.absolutePath).toBe(join(testDir, 'test.ts'));
      expect(result.relativePath).toBe('test.ts');
      expect(result.size).toBeGreaterThan(0);
      expect(result.extension).toBe('.ts');
    });

    it('should use custom excludes when provided', async () => {
      await writeFile(join(testDir, 'keep.ts'), 'keep');
      await writeFile(join(testDir, 'skip.ts'), 'skip');

      const results = await walkFiles(testDir, {
        excludes: ['skip.ts'],
      });

      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain('keep.ts');
      expect(paths).not.toContain('skip.ts');
    });

    it('should handle empty directories', async () => {
      const results = await walkFiles(testDir);
      expect(results).toHaveLength(0);
    });

    it('should exclude secret files by default', async () => {
      await writeFile(join(testDir, 'app.ts'), 'app');
      await writeFile(join(testDir, '.env'), 'SECRET=value');
      await writeFile(join(testDir, '.env.local'), 'LOCAL_SECRET=value');
      await writeFile(join(testDir, 'id_rsa'), 'private key');

      const results = await walkFiles(testDir);

      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain('app.ts');
      expect(paths).not.toContain('.env');
      expect(paths).not.toContain('.env.local');
      expect(paths).not.toContain('id_rsa');
    });
  });
});
