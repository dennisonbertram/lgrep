import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import {
  readHostedWorktreeBinding,
  writeHostedWorktreeBinding,
} from './hosted-worktree-binding.js';

describe('hosted worktree bindings', () => {
  let tempDir: string;
  let repoRoot: string;
  let gitDir: string;
  let branch = 'feature/login';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lgrep-binding-test-'));
    repoRoot = join(tempDir, 'repo');
    gitDir = join(tempDir, 'repo.git');
    await mkdir(repoRoot, { recursive: true });
    await mkdir(gitDir, { recursive: true });

    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation((_: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return `${repoRoot}\n`;
      }
      if (args.includes('--show-current')) {
        return `${branch}\n`;
      }
      if (args.includes('--git-dir')) {
        return `${gitDir}\n`;
      }
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes a binding into the git admin directory and reads it back', async () => {
    const written = await writeHostedWorktreeBinding(join(repoRoot, 'src'), {
      projectId: 'project-1',
      projectName: 'lgrep',
      worktreeId: 'worktree-1',
      worktreeName: 'feature-login',
      serverUrl: 'https://lgrep.example.com',
    });

    expect(written.path).toBe(join(gitDir, 'lgrep-worktree.json'));
    expect(written.binding.projectName).toBe('lgrep');
    expect(written.binding.worktreeName).toBe('feature-login');
    expect(written.binding.branch).toBe('feature/login');

    const read = await readHostedWorktreeBinding(join(repoRoot, 'src'), {
      serverUrl: 'https://lgrep.example.com',
    });

    expect(read?.path).toBe(join(gitDir, 'lgrep-worktree.json'));
    expect(read?.binding.projectId).toBe('project-1');
    expect(read?.binding.worktreeId).toBe('worktree-1');
    expect(read?.binding.branch).toBe('feature/login');
  });

  it('ignores a binding when the current branch no longer matches', async () => {
    await writeHostedWorktreeBinding(repoRoot, {
      projectName: 'lgrep',
      worktreeName: 'feature-login',
      serverUrl: 'https://lgrep.example.com',
    });

    branch = 'main';

    const read = await readHostedWorktreeBinding(repoRoot, {
      serverUrl: 'https://lgrep.example.com',
    });

    expect(read).toBeNull();
  });

  it('ignores a binding when the configured hosted server URL changes', async () => {
    await writeHostedWorktreeBinding(repoRoot, {
      projectName: 'lgrep',
      worktreeName: 'feature-login',
      serverUrl: 'https://lgrep.example.com',
    });

    const read = await readHostedWorktreeBinding(repoRoot, {
      serverUrl: 'https://other.example.com',
    });

    expect(read).toBeNull();
  });
});
