import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runProfileCreateCommand, runProfileListCommand, runProfileUseCommand } from './profile.js';

describe('profile command', () => {
  let testHome: string;
  let originalHome: string | undefined;
  let originalLgrepHome: string | undefined;
  let originalLgrepProfile: string | undefined;

  beforeEach(async () => {
    testHome = join(tmpdir(), `lgrep-profile-test-${randomUUID()}`);
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

  it('creates, lists, and activates named profiles', async () => {
    const createResult = await runProfileCreateCommand('cloud');
    expect(createResult.created).toBe(true);
    expect(createResult.path).toContain('/lgrep/profiles/cloud');

    const useResult = await runProfileUseCommand('cloud');
    expect(useResult.profile).toBe('cloud');

    const listResult = await runProfileListCommand();
    expect(listResult.activeProfile).toBe('cloud');
    expect(listResult.profiles.some((profile) => profile.name === 'default')).toBe(true);
    expect(listResult.profiles.some((profile) => profile.name === 'cloud' && profile.isActive)).toBe(true);
  });
});
