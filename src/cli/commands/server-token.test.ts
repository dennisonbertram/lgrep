import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runServerTokenCreateCommand, runServerTokenListCommand } from './server-token.js';

describe('server token commands', () => {
  let testHome: string;
  let originalHome: string | undefined;
  let originalLgrepHome: string | undefined;

  beforeEach(async () => {
    testHome = join(tmpdir(), `lgrep-server-token-test-${randomUUID()}`);
    await mkdir(testHome, { recursive: true });

    originalHome = process.env['HOME'];
    originalLgrepHome = process.env['LGREP_HOME'];

    process.env['HOME'] = testHome;
    process.env['LGREP_HOME'] = join(testHome, 'lgrep-home');
    await mkdir(process.env['LGREP_HOME']!, { recursive: true });
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

    await rm(testHome, { recursive: true, force: true });
  });

  it('creates and lists a scoped hosted token', async () => {
    const created = await runServerTokenCreateCommand({
      label: 'repo agents',
      projects: 'repo-main',
      worktrees: 'main,feature-login',
    });

    expect(created.label).toBe('repo agents');
    expect(created.projects).toEqual(['repo-main']);
    expect(created.worktrees).toEqual(['feature-login', 'main']);
    expect(created.token.length).toBeGreaterThan(20);

    const listed = await runServerTokenListCommand();
    expect(listed.tokens).toHaveLength(1);
    expect(listed.tokens[0]).toMatchObject({
      label: 'repo agents',
      projects: ['repo-main'],
      worktrees: ['feature-login', 'main'],
    });
  });
});
