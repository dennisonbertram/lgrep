import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG, saveConfig } from './config.js';

const { readR2CredentialsMock } = vi.hoisted(() => ({
  readR2CredentialsMock: vi.fn(),
}));

vi.mock('./keychain.js', () => ({
  readR2Credentials: readR2CredentialsMock,
}));

import { getConfiguredDatabaseLocationSync, resolveDatabaseSettings } from './database-config.js';

describe('database config resolution', () => {
  let testHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testHome = join(tmpdir(), `lgrep-db-config-test-${randomUUID()}`);
    await mkdir(testHome, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testHome;
    readR2CredentialsMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testHome, { recursive: true, force: true });
  });

  it('resolves local database settings by default', async () => {
    const settings = await resolveDatabaseSettings();

    expect(settings.mode).toBe('local');
    expect(settings.uri).toBe(join(testHome, 'db'));
    expect(settings.storageOptions).toBeUndefined();
  });

  it('resolves s3 settings using configured endpoint, region, and env-backed credentials', async () => {
    process.env['R2_ACCESS_KEY_ID'] = 'test-access-key';
    process.env['R2_SECRET_ACCESS_KEY'] = 'test-secret-key';

    await saveConfig({
      ...DEFAULT_CONFIG,
      storageMode: 's3',
      storageUri: 's3://lgrep-test/indexes',
      storageEndpoint: 'https://example.r2.cloudflarestorage.com',
      storageRegion: 'auto',
      storageAccessKeyEnv: 'R2_ACCESS_KEY_ID',
      storageSecretKeyEnv: 'R2_SECRET_ACCESS_KEY',
    });

    const settings = await resolveDatabaseSettings();

    expect(settings).toMatchObject({
      mode: 's3',
      uri: 's3://lgrep-test/indexes',
      storageOptions: {
        endpoint: 'https://example.r2.cloudflarestorage.com',
        region: 'auto',
        access_key_id: 'test-access-key',
        secret_access_key: 'test-secret-key',
      },
    });
  });

  it('throws when s3 mode is configured without a storage uri', async () => {
    await saveConfig({
      ...DEFAULT_CONFIG,
      storageMode: 's3',
      storageUri: '',
    });

    await expect(resolveDatabaseSettings()).rejects.toThrow(/storageUri/i);
  });

  it('resolves postgres settings from the configured database url env var', async () => {
    process.env['LGREP_DATABASE_URL'] = 'postgres://db-user:secret@example.com:5432/lgrep?sslmode=require';

    await saveConfig({
      ...DEFAULT_CONFIG,
      storageMode: 'postgres',
      storageDatabaseUrlEnv: 'LGREP_DATABASE_URL',
    });

    const settings = await resolveDatabaseSettings();

    expect(settings).toMatchObject({
      mode: 'postgres',
      uri: 'postgres://db-user:secret@example.com:5432/lgrep?sslmode=require',
      displayUri: 'postgres://example.com:5432/lgrep',
    });
    expect(getConfiguredDatabaseLocationSync()).toBe('postgres://example.com:5432/lgrep');
  });

  it('throws when postgres mode is configured without a database url', async () => {
    await saveConfig({
      ...DEFAULT_CONFIG,
      storageMode: 'postgres',
      storageDatabaseUrlEnv: 'MISSING_DATABASE_URL',
    });

    await expect(resolveDatabaseSettings()).rejects.toThrow(/storageDatabaseUrlEnv/i);
  });

  it('falls back to keychain-backed credentials when configured', async () => {
    readR2CredentialsMock.mockResolvedValue({
      accessKeyId: 'keychain-access',
      secretAccessKey: 'keychain-secret',
    });

    await saveConfig({
      ...DEFAULT_CONFIG,
      storageMode: 's3',
      storageUri: 's3://lgrep-test/indexes',
      storageEndpoint: 'https://example.r2.cloudflarestorage.com',
      storageCredentialSource: 'keychain',
      storageProfile: 'default',
    });

    const settings = await resolveDatabaseSettings();

    expect(readR2CredentialsMock).toHaveBeenCalledWith('default');
    expect(settings).toMatchObject({
      mode: 's3',
      uri: 's3://lgrep-test/indexes',
      storageOptions: {
        endpoint: 'https://example.r2.cloudflarestorage.com',
        region: 'auto',
        access_key_id: 'keychain-access',
        secret_access_key: 'keychain-secret',
      },
    });
  });
});
