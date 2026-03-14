import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

import {
  deleteR2Credentials,
  readR2Credentials,
  supportsKeychain,
  writeR2Credentials,
} from './keychain.js';

describe('macOS keychain helpers', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('reports keychain support only for darwin', () => {
    expect(supportsKeychain('darwin')).toBe(true);
    expect(supportsKeychain('linux')).toBe(false);
  });

  it('reads a stored credential blob from the keychain', async () => {
    execFileMock.mockImplementation((...args) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      callback(null, '{"accessKeyId":"key","secretAccessKey":"secret"}\n', '');
    });

    const credentials = await readR2Credentials('default');

    expect(execFileMock).toHaveBeenCalledWith(
      'security',
      ['find-generic-password', '-s', 'ai.lgrep.r2.default', '-a', 'r2', '-w'],
      expect.any(Function)
    );
    expect(credentials).toEqual({
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
  });

  it('returns null when no keychain item exists', async () => {
    execFileMock.mockImplementation((...args) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      callback(new Error('The specified item could not be found in the keychain.'));
    });

    await expect(readR2Credentials('default')).resolves.toBeNull();
  });

  it('stores credentials in the keychain as a JSON payload', async () => {
    execFileMock.mockImplementation((...args) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      callback(null, '', '');
    });

    await writeR2Credentials('default', {
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      sessionToken: 'session',
    });

    expect(execFileMock).toHaveBeenCalledWith(
      'security',
      [
        'add-generic-password',
        '-U',
        '-s',
        'ai.lgrep.r2.default',
        '-a',
        'r2',
        '-w',
        JSON.stringify({
          accessKeyId: 'key',
          secretAccessKey: 'secret',
          sessionToken: 'session',
        }),
      ],
      expect.any(Function)
    );
  });

  it('deletes stored credentials from the keychain', async () => {
    execFileMock.mockImplementation((...args) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      callback(null, '', '');
    });

    await deleteR2Credentials('default');

    expect(execFileMock).toHaveBeenCalledWith(
      'security',
      ['delete-generic-password', '-s', 'ai.lgrep.r2.default', '-a', 'r2'],
      expect.any(Function)
    );
  });
});
