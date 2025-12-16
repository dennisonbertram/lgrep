import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Mock the embeddings module before importing
vi.mock('../core/embeddings.js', () => ({
  createEmbeddingClient: vi.fn().mockReturnValue({
    model: 'test-model',
    embed: vi.fn().mockImplementation(async (input: string | string[]) => {
      const texts = Array.isArray(input) ? input : [input];
      return {
        embeddings: texts.map(() => [0.1, 0.2, 0.3, 0.4]),
        model: 'test-model',
      };
    }),
    embedQuery: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3, 0.4]],
      model: 'test-model',
    }),
    healthCheck: vi.fn().mockResolvedValue({ ok: true, model: 'test-model', dimensions: 4 }),
    getModelDimensions: vi.fn().mockResolvedValue(4),
  }),
}));

describe('CLI - index command flags', () => {
  let testDir: string;
  let sourceDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let cliPath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-cli-flags-test-${randomUUID()}`);
    sourceDir = join(testDir, 'source');
    await mkdir(sourceDir, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;

    // Create test files
    await writeFile(join(sourceDir, 'file1.txt'), 'Initial content for file one.');
    await writeFile(join(sourceDir, 'file2.ts'), 'function hello() { return "world"; }');

    // Path to CLI - adjust based on build output
    cliPath = join(process.cwd(), 'dist', 'cli', 'index.js');
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('--update flag', () => {
    it('should fail when running index twice without --update flag', async () => {
      // First index should succeed
      const { stdout: stdout1 } = await execAsync(
        `node "${cliPath}" index "${sourceDir}" --name test-index`,
        { env: { ...process.env, LGREP_HOME: testDir } }
      );
      expect(stdout1).toContain('test-index');

      // Second index without --update should fail
      await expect(
        execAsync(`node "${cliPath}" index "${sourceDir}" --name test-index`, {
          env: { ...process.env, LGREP_HOME: testDir },
        })
      ).rejects.toThrow(/already exists/);
    });

    it('should succeed when running index twice with --update flag', async () => {
      // First index
      await execAsync(`node "${cliPath}" index "${sourceDir}" --name update-test`, {
        env: { ...process.env, LGREP_HOME: testDir },
      });

      // Second index with --update should succeed
      const { stdout } = await execAsync(
        `node "${cliPath}" index "${sourceDir}" --name update-test --update`,
        { env: { ...process.env, LGREP_HOME: testDir } }
      );

      expect(stdout).toContain('Updated');
      expect(stdout).toContain('update-test');
    });

    it('should report unchanged files when using --update', async () => {
      // Initial index
      await execAsync(`node "${cliPath}" index "${sourceDir}" --name stats-test`, {
        env: { ...process.env, LGREP_HOME: testDir },
      });

      // Reindex with --update (no changes)
      const { stdout } = await execAsync(
        `node "${cliPath}" index "${sourceDir}" --name stats-test --update`,
        { env: { ...process.env, LGREP_HOME: testDir } }
      );

      expect(stdout).toContain('unchanged');
    });

    it('should detect and report changed files with --update', async () => {
      // Initial index
      await execAsync(`node "${cliPath}" index "${sourceDir}" --name change-test`, {
        env: { ...process.env, LGREP_HOME: testDir },
      });

      // Modify a file
      await writeFile(join(sourceDir, 'file1.txt'), 'MODIFIED content!');

      // Reindex with --update
      const { stdout } = await execAsync(
        `node "${cliPath}" index "${sourceDir}" --name change-test --update`,
        { env: { ...process.env, LGREP_HOME: testDir } }
      );

      expect(stdout).toContain('updated');
    });

    it('should fail with --update when index does not exist', async () => {
      await expect(
        execAsync(`node "${cliPath}" index "${sourceDir}" --name nonexistent --update`, {
          env: { ...process.env, LGREP_HOME: testDir },
        })
      ).rejects.toThrow(/does not exist/);
    });
  });

  describe('--force flag', () => {
    it('should delete and recreate index when using --force', async () => {
      // Initial index
      const { stdout: stdout1 } = await execAsync(
        `node "${cliPath}" index "${sourceDir}" --name force-test`,
        { env: { ...process.env, LGREP_HOME: testDir } }
      );
      expect(stdout1).toContain('Created index');

      // Reindex with --force should succeed and recreate
      const { stdout: stdout2 } = await execAsync(
        `node "${cliPath}" index "${sourceDir}" --name force-test --force`,
        { env: { ...process.env, LGREP_HOME: testDir } }
      );
      expect(stdout2).toContain('Created index');
    });

    it('should work with --force even when index does not exist', async () => {
      // Should create new index (--force is ignored if index doesn't exist)
      const { stdout } = await execAsync(
        `node "${cliPath}" index "${sourceDir}" --name new-force --force`,
        { env: { ...process.env, LGREP_HOME: testDir } }
      );
      expect(stdout).toContain('Created index');
    });

    it('should reprocess all files when using --force (not incremental)', async () => {
      // Initial index
      await execAsync(`node "${cliPath}" index "${sourceDir}" --name reprocess-test`, {
        env: { ...process.env, LGREP_HOME: testDir },
      });

      // Reindex with --force (should not show "unchanged" stats)
      const { stdout } = await execAsync(
        `node "${cliPath}" index "${sourceDir}" --name reprocess-test --force`,
        { env: { ...process.env, LGREP_HOME: testDir } }
      );

      // Force mode should show "Created" not "Updated"
      expect(stdout).toContain('Created index');
      expect(stdout).not.toContain('unchanged');
    });
  });

  describe('flag conflicts', () => {
    it('should fail when both --update and --force are provided', async () => {
      await execAsync(`node "${cliPath}" index "${sourceDir}" --name conflict-test`, {
        env: { ...process.env, LGREP_HOME: testDir },
      });

      await expect(
        execAsync(
          `node "${cliPath}" index "${sourceDir}" --name conflict-test --update --force`,
          { env: { ...process.env, LGREP_HOME: testDir } }
        )
      ).rejects.toThrow(/cannot use both --update and --force/i);
    });
  });

  describe('JSON output with flags', () => {
    it('should output JSON format with --update and --json flags', async () => {
      // Initial index
      await execAsync(`node "${cliPath}" index "${sourceDir}" --name json-test --json`, {
        env: { ...process.env, LGREP_HOME: testDir },
      });

      // Reindex with --update and --json
      const { stdout } = await execAsync(
        `node "${cliPath}" index "${sourceDir}" --name json-test --update --json`,
        { env: { ...process.env, LGREP_HOME: testDir } }
      );

      const result = JSON.parse(stdout);
      expect(result).toHaveProperty('indexed');
      expect(result).toHaveProperty('skipped');
      expect(result.skipped).toBeGreaterThan(0);
    });

    it('should output JSON format with --force and --json flags', async () => {
      // Initial index
      await execAsync(`node "${cliPath}" index "${sourceDir}" --name json-force --json`, {
        env: { ...process.env, LGREP_HOME: testDir },
      });

      // Reindex with --force and --json
      const { stdout } = await execAsync(
        `node "${cliPath}" index "${sourceDir}" --name json-force --force --json`,
        { env: { ...process.env, LGREP_HOME: testDir } }
      );

      const result = JSON.parse(stdout);
      expect(result).toHaveProperty('indexed');
      expect(result.indexed).toBeGreaterThan(0);
    });
  });
});
