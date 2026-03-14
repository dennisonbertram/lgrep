import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const {
  readR2CredentialsMock,
  supportsKeychainMock,
  writeR2CredentialsMock,
} = vi.hoisted(() => ({
  readR2CredentialsMock: vi.fn(),
  supportsKeychainMock: vi.fn(),
  writeR2CredentialsMock: vi.fn(),
}));

vi.mock('../../storage/keychain.js', () => ({
  readR2Credentials: readR2CredentialsMock,
  supportsKeychain: supportsKeychainMock,
  writeR2Credentials: writeR2CredentialsMock,
}));

import { loadConfig } from '../../storage/config.js';
import { runAuthR2Command, runAuthStatusCommand } from './auth.js';

describe('auth command', () => {
  let testHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testHome = join(tmpdir(), `lgrep-auth-test-${randomUUID()}`);
    await mkdir(testHome, { recursive: true });

    originalEnv = { ...process.env };
    process.env['LGREP_HOME'] = testHome;
    process.env['AWS_ACCESS_KEY_ID'] = 'env-access-key';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'env-secret-key';

    supportsKeychainMock.mockReset();
    supportsKeychainMock.mockReturnValue(true);
    writeR2CredentialsMock.mockReset();
    writeR2CredentialsMock.mockResolvedValue(undefined);
    readR2CredentialsMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(testHome, { recursive: true, force: true });
  });

  it('stores R2 credentials from the local environment and switches config to keychain mode', async () => {
    const result = await runAuthR2Command({
      storageUri: 's3://lgrep/indexes',
      endpoint: 'https://example.r2.cloudflarestorage.com',
    });

    expect(writeR2CredentialsMock).toHaveBeenCalledWith('default', {
      accessKeyId: 'env-access-key',
      secretAccessKey: 'env-secret-key',
      sessionToken: undefined,
    });

    const config = await loadConfig();
    expect(config.storageMode).toBe('s3');
    expect(config.storageUri).toBe('s3://lgrep/indexes');
    expect(config.storageEndpoint).toBe('https://example.r2.cloudflarestorage.com');
    expect(config.storageCredentialSource).toBe('keychain');
    expect(config.storageProfile).toBe('default');

    expect(result).toMatchObject({
      success: true,
      profile: 'default',
      storageUri: 's3://lgrep/indexes',
      credentialSource: 'keychain',
    });
  });

  it('reports current keychain-backed auth status', async () => {
    readR2CredentialsMock.mockResolvedValue({
      accessKeyId: 'stored-access',
      secretAccessKey: 'stored-secret',
    });

    await runAuthR2Command({
      storageUri: 's3://lgrep/indexes',
      endpoint: 'https://example.r2.cloudflarestorage.com',
    });

    const status = await runAuthStatusCommand();

    expect(status).toMatchObject({
      success: true,
      storageMode: 's3',
      storageUri: 's3://lgrep/indexes',
      endpoint: 'https://example.r2.cloudflarestorage.com',
      credentialSource: 'keychain',
      profile: 'default',
      keychainSupported: true,
      credentialsStored: true,
    });
  });

  it('fails clearly when required credentials are not available', async () => {
    delete process.env['AWS_ACCESS_KEY_ID'];

    await expect(runAuthR2Command()).rejects.toThrow(/access key/i);
  });
});
