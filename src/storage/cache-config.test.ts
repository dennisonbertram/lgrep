import { afterEach, describe, expect, it } from 'vitest';
import { resolveCacheSettings } from './cache-config.js';
import { DEFAULT_CONFIG } from './config.js';

describe('cache config resolution', () => {
  afterEach(() => {
    delete process.env['LGREP_CACHE_DATABASE_URL'];
    delete process.env['REMOTE_CACHE_URL'];
    delete process.env['LGREP_HOME'];
  });

  it('resolves local cache settings by default', async () => {
    process.env['LGREP_HOME'] = '/tmp/lgrep-cache-config-test';

    const settings = await resolveCacheSettings();

    expect(settings).toEqual({
      mode: 'local',
      location: '/tmp/lgrep-cache-config-test/cache',
      tableName: 'embedding_cache',
    });
  });

  it('resolves postgres cache settings from the configured env var', async () => {
    process.env['REMOTE_CACHE_URL'] = 'postgres://cache-user:secret@example.com:5432/lgrep';

    const settings = await resolveCacheSettings({
      ...DEFAULT_CONFIG,
      cacheBackend: 'postgres',
      cacheDatabaseUrlEnv: 'REMOTE_CACHE_URL',
      cacheTableName: 'shared_embedding_cache',
    });

    expect(settings).toEqual({
      mode: 'postgres',
      location: 'postgres://cache-user:secret@example.com:5432/lgrep',
      tableName: 'shared_embedding_cache',
    });
  });

  it('throws when postgres cache is configured without a database url', async () => {
    await expect(resolveCacheSettings({
      ...DEFAULT_CONFIG,
      cacheBackend: 'postgres',
      cacheDatabaseUrlEnv: 'MISSING_CACHE_URL',
    })).rejects.toThrow(/MISSING_CACHE_URL/);
  });

  it('throws when the cache table name is not a simple identifier', async () => {
    await expect(resolveCacheSettings({
      ...DEFAULT_CONFIG,
      cacheTableName: 'cache.table',
    })).rejects.toThrow(/cacheTableName/);
  });
});
