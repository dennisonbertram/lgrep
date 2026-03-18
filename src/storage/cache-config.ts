import { getCachePath } from '../cli/utils/paths.js';
import { DEFAULT_CONFIG, loadConfig, type LgrepConfig } from './config.js';

export interface CacheSettings {
  mode: 'local' | 'postgres';
  location: string;
  tableName: string;
}

function getEnvValue(name?: string): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) {
    return undefined;
  }
  return process.env[trimmed];
}

function resolveTableName(config: LgrepConfig): string {
  const tableName = config.cacheTableName.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error('cacheTableName must be a simple SQL identifier');
  }
  return tableName;
}

function resolveFromConfig(config: Partial<LgrepConfig>): CacheSettings {
  const mergedConfig: LgrepConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  if (mergedConfig.cacheBackend === 'local') {
    return {
      mode: 'local',
      location: getCachePath(),
      tableName: resolveTableName(mergedConfig),
    };
  }

  const databaseUrl = getEnvValue(mergedConfig.cacheDatabaseUrlEnv);
  if (!databaseUrl) {
    throw new Error(
      `Missing remote cache database URL. Set ${mergedConfig.cacheDatabaseUrlEnv} or switch cacheBackend to "local".`
    );
  }

  return {
    mode: 'postgres',
    location: databaseUrl,
    tableName: resolveTableName(mergedConfig),
  };
}

export async function resolveCacheSettings(config?: Partial<LgrepConfig>): Promise<CacheSettings> {
  return resolveFromConfig(config ?? await loadConfig());
}
