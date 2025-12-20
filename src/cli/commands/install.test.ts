import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { runInstallCommand } from './install.js';
import * as path from 'path';

// Mock fs and os modules
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock('os', () => ({
  homedir: vi.fn(),
}));

// Import mocked modules
import { promises as fs } from 'fs';
import * as os from 'os';

describe('install command', () => {
  const mockHomedir = '/mock/home';
  const skillPath = path.join(mockHomedir, '.claude', 'skills', 'lgrep-search', 'SKILL.md');
  const settingsPath = path.join(mockHomedir, '.claude', 'settings.json');

  // Mock templates
  const mockSkillTemplate = '---\nname: lgrep-search\n---\n# lgrep skill';
  const mockHookTemplate = '#!/bin/bash\necho "lgrep-check"';
  const mockClaudeMdTemplate = '## lgrep\n\nInstructions here';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHomedir);

    // Default mock for fs.access (file doesn't exist)
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    // Mock template loading
    vi.mocked(fs.readFile).mockImplementation((path) => {
      const pathStr = path.toString();
      if (pathStr.includes('templates/skill.md')) {
        return Promise.resolve(mockSkillTemplate);
      }
      if (pathStr.includes('templates/lgrep-check.sh')) {
        return Promise.resolve(mockHookTemplate);
      }
      if (pathStr.includes('templates/claude-md-section.md')) {
        return Promise.resolve(mockClaudeMdTemplate);
      }
      return Promise.reject(new Error('ENOENT'));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('skill creation', () => {
    it('should create skill file with correct content', async () => {
      // Mock fs operations
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await runInstallCommand({
        skipHook: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.skillCreated).toBe(true);
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('lgrep-search'),
        { recursive: true }
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        skillPath,
        expect.stringContaining('name: lgrep-search')
      );
    });

    it('should skip skill creation when --skip-skill flag is set', async () => {
      const result = await runInstallCommand({
        skipSkill: true,
        skipHook: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.skillCreated).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should not overwrite existing skill', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await runInstallCommand({
        skipHook: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.skillCreated).toBe(false);
      expect(result.skillAlreadyExists).toBe(true);
    });
  });

  describe('SessionStart hook', () => {
    const mockSettings = {
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [
              {
                type: 'command',
                command: '~/.claude/hooks/existing.sh',
              },
            ],
          },
        ],
      },
    };

    it('should add SessionStart hook to settings.json', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // Override readFile for settings.json
      vi.mocked(fs.readFile).mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.includes('settings.json')) {
          return Promise.resolve(JSON.stringify(mockSettings));
        }
        if (pathStr.includes('templates/lgrep-check.sh')) {
          return Promise.resolve(mockHookTemplate);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await runInstallCommand({
        skipSkill: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.hookAdded).toBe(true);

      const writeCall = vi.mocked(fs.writeFile).mock.calls.find(
        (call) => call[0] === settingsPath
      );
      expect(writeCall).toBeDefined();

      const writtenSettings = JSON.parse(writeCall![1] as string);
      // Should have added a new entry with matcher ''
      const emptyMatcherEntry = writtenSettings.hooks.SessionStart.find((e: { matcher: string }) => e.matcher === '');
      expect(emptyMatcherEntry).toBeDefined();
      expect(emptyMatcherEntry.hooks).toHaveLength(1);
      expect(emptyMatcherEntry.hooks[0].command).toContain('lgrep-check');
    });

    it('should skip hook when --skip-hook flag is set', async () => {
      const result = await runInstallCommand({
        skipSkill: true,
        skipHook: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.hookAdded).toBe(false);
      expect(fs.readFile).not.toHaveBeenCalledWith(
        settingsPath,
        expect.anything()
      );
    });

    it('should not add duplicate hook if already exists', async () => {
      const settingsWithHook = {
        hooks: {
          SessionStart: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command: '~/.claude/hooks/lgrep-check.sh',
                },
              ],
            },
          ],
        },
      };

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      // Mock access to indicate settings.json exists
      vi.mocked(fs.access).mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.includes('settings.json')) {
          return Promise.resolve(undefined);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      vi.mocked(fs.readFile).mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.includes('settings.json')) {
          return Promise.resolve(JSON.stringify(settingsWithHook));
        }
        if (pathStr.includes('templates/lgrep-check.sh')) {
          return Promise.resolve(mockHookTemplate);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await runInstallCommand({
        skipSkill: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.hookAdded).toBe(false);
      expect(result.hookAlreadyExists).toBe(true);
      expect(fs.writeFile).not.toHaveBeenCalledWith(
        settingsPath,
        expect.anything()
      );
    });

    it('should create hooks structure if settings.json has no hooks', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.includes('settings.json')) {
          return Promise.resolve('{}');
        }
        if (pathStr.includes('templates/lgrep-check.sh')) {
          return Promise.resolve(mockHookTemplate);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await runInstallCommand({
        skipSkill: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.hookAdded).toBe(true);

      const writeCall = vi.mocked(fs.writeFile).mock.calls.find(
        (call) => call[0] === settingsPath
      );
      const writtenSettings = JSON.parse(writeCall![1] as string);
      expect(writtenSettings.hooks).toBeDefined();
      expect(writtenSettings.hooks.SessionStart).toBeDefined();
    });

    it('should create settings.json if it does not exist', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.includes('settings.json')) {
          return Promise.reject(new Error('ENOENT'));
        }
        if (pathStr.includes('templates/lgrep-check.sh')) {
          return Promise.resolve(mockHookTemplate);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await runInstallCommand({
        skipSkill: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.hookAdded).toBe(true);
      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join(mockHomedir, '.claude'),
        { recursive: true }
      );
    });
  });

  describe('user CLAUDE.md', () => {
    it('should update user CLAUDE.md by default', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await runInstallCommand({
        skipSkill: true,
        skipHook: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.userClaudeMdUpdated).toBe(true);
      expect(result.userClaudeMdPath).toContain('.claude/CLAUDE.md');
    });

    it('should skip user CLAUDE.md when --skip-claude-md flag is set', async () => {
      const result = await runInstallCommand({
        skipSkill: true,
        skipHook: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.userClaudeMdUpdated).toBe(false);
    });

    it('should not overwrite existing user CLAUDE.md lgrep section', async () => {
      const mockClaudeMd = '# User Config\n\n## lgrep\n\nExisting lgrep config';

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockImplementation((path) => {
        if (path.toString().includes('.claude/CLAUDE.md')) {
          return Promise.resolve(undefined);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      vi.mocked(fs.readFile).mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.includes('.claude/CLAUDE.md')) {
          return Promise.resolve(mockClaudeMd);
        }
        if (pathStr.includes('templates/claude-md-section.md')) {
          return Promise.resolve(mockClaudeMdTemplate);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await runInstallCommand({
        skipSkill: true,
        skipHook: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.userClaudeMdUpdated).toBe(false);
      expect(result.userClaudeMdAlreadyHasLgrep).toBe(true);
    });
  });

  describe('project CLAUDE.md', () => {
    it('should add lgrep section to project CLAUDE.md when flag is set', async () => {
      const mockClaudeMd = '# Existing content\n\nSome text';

      // Mock access to indicate CLAUDE.md exists
      vi.mocked(fs.access).mockImplementation((path) => {
        if (path.toString().endsWith('CLAUDE.md')) {
          return Promise.resolve(undefined);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      vi.mocked(fs.readFile).mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.includes('settings.json')) {
          return Promise.resolve('{}');
        }
        if (pathStr.endsWith('CLAUDE.md')) {
          return Promise.resolve(mockClaudeMd);
        }
        if (pathStr.includes('templates/claude-md-section.md')) {
          return Promise.resolve(mockClaudeMdTemplate);
        }
        if (pathStr.includes('templates/lgrep-check.sh')) {
          return Promise.resolve(mockHookTemplate);
        }
        return Promise.reject(new Error('ENOENT'));
      });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await runInstallCommand({
        skipSkill: true,
        skipHook: true,
        skipClaudeMd: true,
        addToProject: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.projectClaudeUpdated).toBe(true);

      const writeCall = vi.mocked(fs.writeFile).mock.calls.find(
        (call) => call[0].toString().endsWith('CLAUDE.md')
      );
      expect(writeCall).toBeDefined();
      expect(writeCall![1]).toContain('## lgrep');
      expect(writeCall![1]).toContain(mockClaudeMd);
    });

    it('should not update project CLAUDE.md if lgrep section already exists', async () => {
      const mockClaudeMd = '# Project\n\n## lgrep\n\nExisting lgrep config';

      // Mock access to indicate CLAUDE.md exists
      vi.mocked(fs.access).mockImplementation((path) => {
        if (path.toString().endsWith('CLAUDE.md')) {
          return Promise.resolve(undefined);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      vi.mocked(fs.readFile).mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.endsWith('CLAUDE.md')) {
          return Promise.resolve(mockClaudeMd);
        }
        if (pathStr.includes('templates/claude-md-section.md')) {
          return Promise.resolve(mockClaudeMdTemplate);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await runInstallCommand({
        skipSkill: true,
        skipHook: true,
        skipClaudeMd: true,
        addToProject: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.projectClaudeUpdated).toBe(false);
      expect(result.projectClaudeAlreadyHasLgrep).toBe(true);
    });

    it('should skip project CLAUDE.md when flag is not set', async () => {
      const result = await runInstallCommand({
        skipSkill: true,
        skipHook: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(true);
      expect(result.projectClaudeUpdated).toBe(false);
    });
  });

  describe('JSON output', () => {
    it('should return structured result for JSON output', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await runInstallCommand({
        skipClaudeMd: true,
        json: true,
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('skillCreated');
      expect(result).toHaveProperty('hookAdded');
      expect(result).toHaveProperty('userClaudeMdUpdated');
      expect(result.success).toBe(true);
      // When successful, paths should be set
      if (result.skillCreated) {
        expect(result).toHaveProperty('skillPath');
      }
      if (result.hookAdded) {
        expect(result).toHaveProperty('settingsPath');
      }
    });
  });

  describe('error handling', () => {
    it('should handle filesystem errors gracefully', async () => {
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Permission denied'));

      const result = await runInstallCommand({
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('should handle invalid JSON in settings.json', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // Mock access to indicate settings.json exists
      vi.mocked(fs.access).mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.includes('settings.json')) {
          return Promise.resolve(undefined);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      vi.mocked(fs.readFile).mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.includes('settings.json')) {
          return Promise.resolve('invalid json{');
        }
        if (pathStr.includes('templates/lgrep-check.sh')) {
          return Promise.resolve(mockHookTemplate);
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const result = await runInstallCommand({
        skipSkill: true,
        skipClaudeMd: true,
        json: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('parse');
    });
  });
});
