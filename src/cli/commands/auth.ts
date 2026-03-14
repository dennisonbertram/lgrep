import { loadConfig, saveConfig } from '../../storage/config.js';
import { readR2Credentials, supportsKeychain, writeR2Credentials } from '../../storage/keychain.js';

export interface AuthR2Options {
  profile?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  accessKeyIdEnv?: string;
  secretAccessKeyEnv?: string;
  sessionTokenEnv?: string;
  storageUri?: string;
  endpoint?: string;
  region?: string;
}

export interface AuthR2Result {
  success: boolean;
  profile: string;
  credentialSource: 'keychain';
  storageUri: string;
  endpoint: string;
  region: string;
}

export interface AuthStatusResult {
  success: boolean;
  storageMode: 'local' | 's3';
  storageUri: string;
  endpoint: string;
  credentialSource: 'auto' | 'env' | 'keychain';
  profile: string;
  keychainSupported: boolean;
  credentialsStored: boolean;
}

function getEnvValue(name: string | undefined, fallback: string): string | undefined {
  const envName = name?.trim() || fallback;
  return process.env[envName];
}

export async function runAuthR2Command(options: AuthR2Options = {}): Promise<AuthR2Result> {
  if (!supportsKeychain()) {
    throw new Error('Local keychain storage is currently supported on macOS only');
  }

  const profile = options.profile?.trim() || 'default';
  const accessKeyId = options.accessKeyId ?? getEnvValue(options.accessKeyIdEnv, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = options.secretAccessKey ?? getEnvValue(options.secretAccessKeyEnv, 'AWS_SECRET_ACCESS_KEY');
  const sessionToken = options.sessionToken ?? getEnvValue(options.sessionTokenEnv, 'AWS_SESSION_TOKEN');

  if (!accessKeyId) {
    throw new Error('Missing access key ID. Set AWS_ACCESS_KEY_ID or pass --access-key-id.');
  }
  if (!secretAccessKey) {
    throw new Error('Missing secret access key. Set AWS_SECRET_ACCESS_KEY or pass --secret-access-key.');
  }

  await writeR2Credentials(profile, {
    accessKeyId,
    secretAccessKey,
    sessionToken,
  });

  const config = await loadConfig();
  const updatedConfig = {
    ...config,
    storageMode: options.storageUri || config.storageUri ? 's3' as const : config.storageMode,
    storageUri: options.storageUri ?? config.storageUri,
    storageEndpoint: options.endpoint ?? config.storageEndpoint,
    storageRegion: options.region ?? config.storageRegion,
    storageCredentialSource: 'keychain' as const,
    storageProfile: profile,
  };
  await saveConfig(updatedConfig);

  return {
    success: true,
    profile,
    credentialSource: 'keychain',
    storageUri: updatedConfig.storageUri,
    endpoint: updatedConfig.storageEndpoint,
    region: updatedConfig.storageRegion,
  };
}

export async function runAuthStatusCommand(profile?: string): Promise<AuthStatusResult> {
  const config = await loadConfig();
  const resolvedProfile = profile?.trim() || config.storageProfile;
  const keychainSupported = supportsKeychain();
  const credentialsStored = keychainSupported
    ? (await readR2Credentials(resolvedProfile)) !== null
    : false;

  return {
    success: true,
    storageMode: config.storageMode,
    storageUri: config.storageUri,
    endpoint: config.storageEndpoint,
    credentialSource: config.storageCredentialSource,
    profile: resolvedProfile,
    keychainSupported,
    credentialsStored,
  };
}
