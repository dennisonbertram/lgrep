import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { queryServerMock, execFileSyncMock, getServerUrlMock } = vi.hoisted(() => ({
  queryServerMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  getServerUrlMock: vi.fn(),
}));

vi.mock('../../server/client.js', () => ({
  queryServer: queryServerMock,
  getServerUrl: getServerUrlMock,
}));

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { detectHostedScopeForDirectory } from './hosted-auto-detect.js';
import { writeHostedWorktreeBinding } from './hosted-worktree-binding.js';

describe('detectHostedScopeForDirectory', () => {
  let tempDir: string;

  beforeEach(() => {
    queryServerMock.mockReset();
    execFileSyncMock.mockReset();
    getServerUrlMock.mockReset();
    getServerUrlMock.mockReturnValue('https://lgrep.example.com');
    delete process.env['LGREP_PROJECT'];
    delete process.env['LGREP_WORKTREE'];
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env['LGREP_PROJECT'];
    delete process.env['LGREP_WORKTREE'];
  });

  it('matches the current git repo and branch to a hosted project/worktree', async () => {
    execFileSyncMock.mockImplementation((_: string, args: string[]) => {
      if (args.includes('--show-toplevel')) return '/Users/example/repos/lgrep\n';
      if (args.includes('--show-current')) return 'codex/local-cloud-onboarding\n';
      if (args.includes('--git-dir')) return '/Users/example/repos/lgrep/.git\n';
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });

    queryServerMock.mockImplementation(async (request: { method: string; project?: string }) => {
      if (request.method === 'projects') {
        return {
          projects: [
            {
              id: 'p1',
              name: 'lgrep',
              displayName: null,
              repoUrl: null,
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 1,
        };
      }

      if (request.method === 'worktrees' && request.project === 'lgrep') {
        return {
          project: 'lgrep',
          worktrees: [
            {
              id: 'w1',
              name: 'global-remote-install',
              rootPath: null,
              repoUrl: null,
              branch: 'codex/global-remote-install',
              baseCommit: null,
              parentId: null,
              projectId: 'p1',
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              status: 'ready',
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
            {
              id: 'w2',
              name: 'local-cloud-onboarding',
              rootPath: null,
              repoUrl: null,
              branch: 'codex/local-cloud-onboarding',
              baseCommit: null,
              parentId: null,
              projectId: 'p1',
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              status: 'ready',
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 2,
        };
      }

      throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
    });

    const result = await detectHostedScopeForDirectory('/Users/example/repos/lgrep/src');

    expect(result).toEqual({
      project: 'lgrep',
      worktree: 'local-cloud-onboarding',
    });
  });

  it('returns null for an unbound repo on a generic branch even when only one hosted project exists', async () => {
    execFileSyncMock.mockImplementation((_: string, args: string[]) => {
      if (args.includes('--show-toplevel')) return '/Users/example/repos/unknown\n';
      if (args.includes('--show-current')) return 'main\n';
      if (args.includes('--git-dir')) return '/Users/example/repos/unknown/.git\n';
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });

    queryServerMock.mockImplementation(async (request: { method: string; project?: string }) => {
      if (request.method === 'projects') {
        return {
          projects: [
            {
              id: 'p1',
              name: 'repo-main',
              displayName: null,
              repoUrl: null,
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 1,
        };
      }

      if (request.method === 'worktrees' && request.project === 'repo-main') {
        return {
          project: 'repo-main',
          worktrees: [
            {
              id: 'w1',
              name: 'main',
              rootPath: null,
              repoUrl: null,
              branch: 'main',
              baseCommit: null,
              parentId: null,
              projectId: 'p1',
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              status: 'ready',
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 1,
        };
      }

      throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
    });

    const result = await detectHostedScopeForDirectory('/Users/example/repos/unknown');

    expect(result).toBeNull();
  });

  it('returns null when multiple hosted worktrees match equally', async () => {
    execFileSyncMock.mockImplementation((_: string, args: string[]) => {
      if (args.includes('--show-toplevel')) return '/Users/example/repos/demo\n';
      if (args.includes('--show-current')) return 'feature/login\n';
      if (args.includes('--git-dir')) return '/Users/example/repos/demo/.git\n';
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });

    queryServerMock.mockImplementation(async (request: { method: string; project?: string }) => {
      if (request.method === 'projects') {
        return {
          projects: [
            {
              id: 'p1',
              name: 'demo',
              displayName: null,
              repoUrl: null,
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 1,
        };
      }

      if (request.method === 'worktrees' && request.project === 'demo') {
        return {
          project: 'demo',
          worktrees: [
            {
              id: 'w1',
              name: 'feature-login',
              rootPath: null,
              repoUrl: null,
              branch: 'feature/login',
              baseCommit: null,
              parentId: null,
              projectId: 'p1',
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              status: 'ready',
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
            {
              id: 'w2',
              name: 'feature-login',
              rootPath: null,
              repoUrl: null,
              branch: 'feature/login',
              baseCommit: null,
              parentId: null,
              projectId: 'p1',
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              status: 'ready',
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 2,
        };
      }

      throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
    });

    const result = await detectHostedScopeForDirectory('/Users/example/repos/demo');

    expect(result).toEqual({
      project: 'demo',
      worktree: undefined,
    });
  });

  it('prefers an explicit local binding over hosted heuristics', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lgrep-hosted-auto-detect-'));
    const repoRoot = join(tempDir, 'lgrep');
    const gitDir = join(tempDir, 'lgrep.git');
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await mkdir(gitDir, { recursive: true });

    execFileSyncMock.mockImplementation((_: string, args: string[]) => {
      if (args.includes('--show-toplevel')) return `${repoRoot}\n`;
      if (args.includes('--show-current')) return 'codex/local-cloud-onboarding\n';
      if (args.includes('--git-dir')) return `${gitDir}\n`;
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });

    await writeHostedWorktreeBinding(join(repoRoot, 'src'), {
      projectName: 'bound-project',
      worktreeName: 'bound-worktree',
      serverUrl: 'https://lgrep.example.com',
    });

    const result = await detectHostedScopeForDirectory(join(repoRoot, 'src'));

    expect(result).toEqual({
      project: 'bound-project',
      worktree: 'bound-worktree',
    });
    expect(queryServerMock).not.toHaveBeenCalled();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prefers LGREP_PROJECT/LGREP_WORKTREE over bindings and heuristics', async () => {
    process.env['LGREP_PROJECT'] = 'env-project';
    process.env['LGREP_WORKTREE'] = 'env-worktree';

    tempDir = await mkdtemp(join(tmpdir(), 'lgrep-hosted-auto-detect-'));
    const repoRoot = join(tempDir, 'lgrep');
    const gitDir = join(tempDir, 'lgrep.git');
    await mkdir(repoRoot, { recursive: true });
    await mkdir(gitDir, { recursive: true });

    execFileSyncMock.mockImplementation((_: string, args: string[]) => {
      if (args.includes('--show-toplevel')) return `${repoRoot}\n`;
      if (args.includes('--show-current')) return 'main\n';
      if (args.includes('--git-dir')) return `${gitDir}\n`;
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });

    await writeHostedWorktreeBinding(repoRoot, {
      projectName: 'bound-project',
      worktreeName: 'bound-worktree',
      serverUrl: 'https://lgrep.example.com',
    });

    const result = await detectHostedScopeForDirectory(repoRoot);

    expect(result).toEqual({
      project: 'env-project',
      worktree: 'env-worktree',
    });
    expect(queryServerMock).not.toHaveBeenCalled();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('falls back to heuristics when a local binding is stale', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lgrep-hosted-auto-detect-'));
    const repoRoot = join(tempDir, 'lgrep');
    const gitDir = join(tempDir, 'lgrep.git');
    await mkdir(repoRoot, { recursive: true });
    await mkdir(gitDir, { recursive: true });

    execFileSyncMock.mockImplementation((_: string, args: string[]) => {
      if (args.includes('--show-toplevel')) return `${repoRoot}\n`;
      if (args.includes('--show-current')) return 'main\n';
      if (args.includes('--git-dir')) return `${gitDir}\n`;
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });

    await writeHostedWorktreeBinding(repoRoot, {
      projectName: 'bound-project',
      worktreeName: 'stale-worktree',
      branch: 'feature/login',
      serverUrl: 'https://lgrep.example.com',
    });

    queryServerMock.mockImplementation(async (request: { method: string; project?: string }) => {
      if (request.method === 'projects') {
        return {
          projects: [
            {
              id: 'p1',
              name: 'lgrep',
              displayName: null,
              repoUrl: null,
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 1,
        };
      }

      if (request.method === 'worktrees' && request.project === 'lgrep') {
        return {
          project: 'lgrep',
          worktrees: [
            {
              id: 'w1',
              name: 'main',
              rootPath: null,
              repoUrl: null,
              branch: 'main',
              baseCommit: null,
              parentId: null,
              projectId: 'p1',
              model: 'openai:text-embedding-3-small',
              modelDims: 1536,
              chunkMaxTokens: 500,
              chunkOverlap: 50,
              status: 'ready',
              fileCount: 100,
              chunkCount: 200,
              createdAt: 'now',
              updatedAt: 'now',
            },
          ],
          count: 1,
        };
      }

      throw new Error(`Unexpected request: ${JSON.stringify(request)}`);
    });

    const result = await detectHostedScopeForDirectory(repoRoot);

    expect(result).toEqual({
      project: 'lgrep',
      worktree: 'main',
    });
    await rm(tempDir, { recursive: true, force: true });
  });
});
