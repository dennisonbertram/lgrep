import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runInitCommand } from './init.js';
import { getActiveProfileName, getProfileHome } from '../utils/profiles.js';

describe('init command', () => {
  let testHome: string;
  let originalHome: string | undefined;
  let originalLgrepHome: string | undefined;
  let originalLgrepProfile: string | undefined;

  beforeEach(async () => {
    testHome = join(tmpdir(), `lgrep-init-test-${randomUUID()}`);
    await mkdir(testHome, { recursive: true });

    originalHome = process.env['HOME'];
    originalLgrepHome = process.env['LGREP_HOME'];
    originalLgrepProfile = process.env['LGREP_PROFILE'];

    process.env['HOME'] = testHome;
    delete process.env['LGREP_HOME'];
    delete process.env['LGREP_PROFILE'];
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = originalHome;
    }

    if (originalLgrepHome === undefined) {
      delete process.env['LGREP_HOME'];
    } else {
      process.env['LGREP_HOME'] = originalLgrepHome;
    }

    if (originalLgrepProfile === undefined) {
      delete process.env['LGREP_PROFILE'];
    } else {
      process.env['LGREP_PROFILE'] = originalLgrepProfile;
    }

    await rm(testHome, { recursive: true, force: true });
  });

  it('configures a local profile without indexing', async () => {
    const cwd = join(testHome, 'repo');
    await mkdir(cwd, { recursive: true });

    const result = await runInitCommand({
      mode: 'local',
      profile: 'local',
      embedding: 'openai',
      integration: 'none',
      skipIndex: true,
      cwd,
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('local');
    expect(result.profile).toBe('local');
    expect(getActiveProfileName()).toBe('local');

    const configPath = join(getProfileHome('local'), 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as { storageMode: string; cacheBackend: string; model: string };
    expect(config.storageMode).toBe('local');
    expect(config.cacheBackend).toBe('local');
    expect(config.model).toBe('openai:text-embedding-3-small');
  });

  it('accepts default local setup with --yes', async () => {
    const cwd = join(testHome, 'repo-defaults');
    await mkdir(cwd, { recursive: true });

    const result = await runInitCommand({
      yes: true,
      integration: 'none',
      skipIndex: true,
      cwd,
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('local');
    expect(result.profile).toBe('local');

    const configPath = join(getProfileHome('local'), 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as { storageMode: string; cacheBackend: string; model: string };
    expect(config.storageMode).toBe('local');
    expect(config.cacheBackend).toBe('local');
    expect(config.model).toBe('auto');
  });

  it('configures a cloud profile with Postgres settings', async () => {
    const cwd = join(testHome, 'repo-cloud');
    await mkdir(cwd, { recursive: true });

    const result = await runInitCommand({
      mode: 'cloud',
      profile: 'cloud',
      databaseUrlEnv: 'LGREP_DATABASE_URL',
      integration: 'none',
      skipIndex: true,
      cwd,
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('cloud');
    expect(result.profile).toBe('cloud');

    const configPath = join(getProfileHome('cloud'), 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf-8')) as {
      storageMode: string;
      cacheBackend: string;
      storageDatabaseUrlEnv: string;
      cacheDatabaseUrlEnv: string;
    };
    expect(config.storageMode).toBe('postgres');
    expect(config.cacheBackend).toBe('postgres');
    expect(config.storageDatabaseUrlEnv).toBe('LGREP_DATABASE_URL');
    expect(config.cacheDatabaseUrlEnv).toBe('LGREP_DATABASE_URL');
  });
});
