import { existsSync, readFileSync } from 'node:fs';
import { getConfigPath, getDbPath } from '../cli/utils/paths.js';
import { DEFAULT_CONFIG, loadConfig, type LgrepConfig } from './config.js';
import { readR2Credentials, type R2Credentials } from './keychain.js';
import { openDatabase, type IndexDatabase } from './lance.js';

export interface DatabaseSettings {
  mode: 'local' | 's3';
  uri: string;
  storageOptions?: Record<string, string>;
}

function mergeConfig(partial?: Partial<LgrepConfig>): LgrepConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(partial ?? {}),
  };
}

function loadConfigSync(): LgrepConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return mergeConfig(JSON.parse(content) as Partial<LgrepConfig>);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function getEnvValue(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) {
    return undefined;
  }
  return process.env[trimmed];
}

function getEnvCredentials(config: LgrepConfig): R2Credentials | null {
  const accessKey = getEnvValue(config.storageAccessKeyEnv);
  const secretKey = getEnvValue(config.storageSecretKeyEnv);
  const sessionToken = getEnvValue(config.storageSessionTokenEnv);

  if (!accessKey || !secretKey) {
    return null;
  }

  return {
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    sessionToken,
  };
}

async function resolveCredentials(config: LgrepConfig): Promise<R2Credentials | null> {
  const source = config.storageCredentialSource;

  if (source === 'env') {
    return getEnvCredentials(config);
  }

  if (source === 'keychain') {
    return await readR2Credentials(config.storageProfile);
  }

  return getEnvCredentials(config) ?? await readR2Credentials(config.storageProfile);
}

async function buildS3StorageOptions(config: LgrepConfig): Promise<Record<string, string> | undefined> {
  const options: Record<string, string> = {};

  if (config.storageEndpoint.trim()) {
    options['endpoint'] = config.storageEndpoint.trim();
  }
  if (config.storageRegion.trim()) {
    options['region'] = config.storageRegion.trim();
  }

  const credentials = await resolveCredentials(config);
  if (credentials?.accessKeyId) {
    options['access_key_id'] = credentials.accessKeyId;
  }
  if (credentials?.secretAccessKey) {
    options['secret_access_key'] = credentials.secretAccessKey;
  }
  if (credentials?.sessionToken) {
    options['session_token'] = credentials.sessionToken;
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

function buildS3StorageOptionsSync(config: LgrepConfig): Record<string, string> | undefined {
  const options: Record<string, string> = {};

  if (config.storageEndpoint.trim()) {
    options['endpoint'] = config.storageEndpoint.trim();
  }
  if (config.storageRegion.trim()) {
    options['region'] = config.storageRegion.trim();
  }

  const credentials = getEnvCredentials(config);
  if (credentials?.accessKeyId) {
    options['access_key_id'] = credentials.accessKeyId;
  }
  if (credentials?.secretAccessKey) {
    options['secret_access_key'] = credentials.secretAccessKey;
  }
  if (credentials?.sessionToken) {
    options['session_token'] = credentials.sessionToken;
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

async function resolveFromConfig(config: LgrepConfig): Promise<DatabaseSettings> {
  const mergedConfig = mergeConfig(config);

  if (mergedConfig.storageMode === 'local') {
    return {
      mode: 'local',
      uri: getDbPath(),
    };
  }

  const storageUri = mergedConfig.storageUri.trim();
  if (!storageUri) {
    throw new Error('storageUri is required when storageMode is "s3"');
  }

  return {
    mode: 's3',
    uri: storageUri,
    storageOptions: await buildS3StorageOptions(mergedConfig),
  };
}

export async function resolveDatabaseSettings(): Promise<DatabaseSettings> {
  return await resolveFromConfig(await loadConfig());
}

export function resolveDatabaseSettingsSync(): DatabaseSettings {
  const mergedConfig = loadConfigSync();

  if (mergedConfig.storageMode === 'local') {
    return {
      mode: 'local',
      uri: getDbPath(),
    };
  }

  const storageUri = mergedConfig.storageUri.trim();
  if (!storageUri) {
    throw new Error('storageUri is required when storageMode is "s3"');
  }

  return {
    mode: 's3',
    uri: storageUri,
    storageOptions: buildS3StorageOptionsSync(mergedConfig),
  };
}

export async function openConfiguredDatabase(): Promise<IndexDatabase> {
  return openDatabase(await resolveDatabaseSettings());
}

export function getConfiguredDatabaseLocationSync(): string {
  return resolveDatabaseSettingsSync().uri;
}
