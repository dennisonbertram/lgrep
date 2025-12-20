import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfig,
  saveConfig,
  getConfigValue,
  setConfigValue,
  DEFAULT_CONFIG,
  type LgrepConfig,
} from './config.js';

describe('config management', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `lgrep-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    process.env['LGREP_HOME'] = testDir;
  });

  afterEach(async () => {
    // Clean up temp directory
    delete process.env['LGREP_HOME'];
    await rm(testDir, { recursive: true, force: true });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have default model set to auto for provider auto-detection', () => {
      expect(DEFAULT_CONFIG.model).toBe('auto');
    });

    it('should have default chunk size of 500', () => {
      expect(DEFAULT_CONFIG.chunkSize).toBe(500);
    });

    it('should have default chunk overlap of 50', () => {
      expect(DEFAULT_CONFIG.chunkOverlap).toBe(50);
    });

    it('should have default max file size of 5MB', () => {
      expect(DEFAULT_CONFIG.maxFileSize).toBe(5 * 1024 * 1024);
    });

    it('should have default excludes array', () => {
      expect(DEFAULT_CONFIG.excludes).toContain('.git');
      expect(DEFAULT_CONFIG.excludes).toContain('node_modules');
    });

    it('should have default summarization model set to auto', () => {
      expect(DEFAULT_CONFIG.summarizationModel).toBe('auto');
    });

    it('should have summarization enabled by default', () => {
      expect(DEFAULT_CONFIG.enableSummarization).toBe(true);
    });

    it('should have default max summary length of 100', () => {
      expect(DEFAULT_CONFIG.maxSummaryLength).toBe(100);
    });

    it('should have default context max tokens of 32000', () => {
      expect(DEFAULT_CONFIG.contextMaxTokens).toBe(32000);
    });

    it('should have default context graph depth of 2', () => {
      expect(DEFAULT_CONFIG.contextGraphDepth).toBe(2);
    });

    it('should have default context file limit of 15', () => {
      expect(DEFAULT_CONFIG.contextFileLimit).toBe(15);
    });

    it('should have default embed batch size of 10', () => {
      expect(DEFAULT_CONFIG.embedBatchSize).toBe(10);
    });

    it('should have default db batch size of 250', () => {
      expect(DEFAULT_CONFIG.dbBatchSize).toBe(250);
    });
  });

  describe('loadConfig', () => {
    it('should return default config when no config file exists', async () => {
      const config = await loadConfig();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should load existing config from file', async () => {
      // Create a config file first
      const customConfig: LgrepConfig = {
        ...DEFAULT_CONFIG,
        model: 'custom-model',
        chunkSize: 1000,
      };
      await saveConfig(customConfig);

      const loaded = await loadConfig();
      expect(loaded.model).toBe('custom-model');
      expect(loaded.chunkSize).toBe(1000);
    });

    it('should merge partial config with defaults', async () => {
      // Write a partial config file manually
      const configPath = join(testDir, 'config.json');
      await mkdir(testDir, { recursive: true });
      const partialConfig = { model: 'partial-model' };
      const { writeFile } = await import('node:fs/promises');
      await writeFile(configPath, JSON.stringify(partialConfig));

      const loaded = await loadConfig();
      expect(loaded.model).toBe('partial-model');
      // Should still have defaults for other fields
      expect(loaded.chunkSize).toBe(DEFAULT_CONFIG.chunkSize);
      expect(loaded.excludes).toEqual(DEFAULT_CONFIG.excludes);
    });
  });

  describe('saveConfig', () => {
    it('should save config to file', async () => {
      const config: LgrepConfig = {
        ...DEFAULT_CONFIG,
        model: 'saved-model',
      };

      await saveConfig(config);

      const configPath = join(testDir, 'config.json');
      const content = await readFile(configPath, 'utf-8');
      const saved = JSON.parse(content);
      expect(saved.model).toBe('saved-model');
    });

    it('should create config directory if it does not exist', async () => {
      // Remove the test directory
      await rm(testDir, { recursive: true, force: true });

      await saveConfig(DEFAULT_CONFIG);

      const configPath = join(testDir, 'config.json');
      const content = await readFile(configPath, 'utf-8');
      expect(JSON.parse(content)).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('getConfigValue', () => {
    it('should get a specific config value', async () => {
      const config: LgrepConfig = {
        ...DEFAULT_CONFIG,
        model: 'test-model',
      };
      await saveConfig(config);

      const value = await getConfigValue('model');
      expect(value).toBe('test-model');
    });

    it('should return default value when config file does not exist', async () => {
      const value = await getConfigValue('model');
      expect(value).toBe(DEFAULT_CONFIG.model);
    });
  });

  describe('setConfigValue', () => {
    it('should set a specific config value', async () => {
      await setConfigValue('model', 'new-model');

      const config = await loadConfig();
      expect(config.model).toBe('new-model');
    });

    it('should preserve other config values when setting one', async () => {
      const initial: LgrepConfig = {
        ...DEFAULT_CONFIG,
        model: 'initial-model',
        chunkSize: 999,
      };
      await saveConfig(initial);

      await setConfigValue('model', 'updated-model');

      const config = await loadConfig();
      expect(config.model).toBe('updated-model');
      expect(config.chunkSize).toBe(999); // Should be preserved
    });

    it('should set embedBatchSize value', async () => {
      await setConfigValue('embedBatchSize', 20);

      const config = await loadConfig();
      expect(config.embedBatchSize).toBe(20);
    });

    it('should set dbBatchSize value', async () => {
      await setConfigValue('dbBatchSize', 500);

      const config = await loadConfig();
      expect(config.dbBatchSize).toBe(500);
    });
  });
});
