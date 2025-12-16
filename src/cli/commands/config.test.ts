import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runConfigCommand } from './config.js';

describe('config command', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-config-cmd-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });

    // Save and override LGREP_HOME
    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testDir, { recursive: true, force: true });
  });

  describe('show all config', () => {
    it('should show default config when no config file exists', async () => {
      const output = await runConfigCommand();

      expect(output).toContain('model');
      expect(output).toContain('mxbai-embed-large');
      expect(output).toContain('chunkSize');
    });

    it('should show saved config values', async () => {
      const configPath = join(testDir, 'config.json');
      await writeFile(configPath, JSON.stringify({ model: 'custom-model' }));

      const output = await runConfigCommand();

      expect(output).toContain('custom-model');
    });
  });

  describe('get single value', () => {
    it('should get a specific config value', async () => {
      const output = await runConfigCommand('model');

      expect(output).toBe('mxbai-embed-large');
    });

    it('should return error for non-existent key', async () => {
      await expect(runConfigCommand('nonexistent')).rejects.toThrow(/unknown config key/i);
    });
  });

  describe('set value', () => {
    it('should set a config value', async () => {
      const output = await runConfigCommand('model', 'new-model');

      expect(output).toContain('model');
      expect(output).toContain('new-model');

      // Verify it was saved
      const configPath = join(testDir, 'config.json');
      const saved = JSON.parse(await readFile(configPath, 'utf-8'));
      expect(saved.model).toBe('new-model');
    });

    it('should set numeric values correctly', async () => {
      await runConfigCommand('chunkSize', '1000');

      const configPath = join(testDir, 'config.json');
      const saved = JSON.parse(await readFile(configPath, 'utf-8'));
      expect(saved.chunkSize).toBe(1000);
    });

    it('should reject invalid config keys', async () => {
      await expect(runConfigCommand('invalid', 'value')).rejects.toThrow(/unknown config key/i);
    });
  });
});
