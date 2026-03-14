import { execFile } from 'node:child_process';
const R2_ACCOUNT_NAME = 'r2';

export interface R2Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export function supportsKeychain(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin';
}

function getKeychainServiceName(profile: string): string {
  return `ai.lgrep.r2.${profile}`;
}

async function runSecurityCommand(args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile('security', args, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export async function readR2Credentials(profile = 'default'): Promise<R2Credentials | null> {
  if (!supportsKeychain()) {
    return null;
  }

  try {
    const stdout = await runSecurityCommand([
      'find-generic-password',
      '-s',
      getKeychainServiceName(profile),
      '-a',
      R2_ACCOUNT_NAME,
      '-w',
    ]);

    return JSON.parse(stdout.trim()) as R2Credentials;
  } catch {
    return null;
  }
}

export async function writeR2Credentials(
  profile: string,
  credentials: R2Credentials
): Promise<void> {
  if (!supportsKeychain()) {
    throw new Error('Local keychain storage is currently supported on macOS only');
  }

  await runSecurityCommand([
    'add-generic-password',
    '-U',
    '-s',
    getKeychainServiceName(profile),
    '-a',
    R2_ACCOUNT_NAME,
    '-w',
    JSON.stringify(credentials),
  ]);
}

export async function deleteR2Credentials(profile: string): Promise<void> {
  if (!supportsKeychain()) {
    throw new Error('Local keychain storage is currently supported on macOS only');
  }

  await runSecurityCommand([
    'delete-generic-password',
    '-s',
    getKeychainServiceName(profile),
    '-a',
    R2_ACCOUNT_NAME,
  ]);
}
