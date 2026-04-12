import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const {
  spawnMock,
  runInstallCommandMock,
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  runInstallCommandMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('./install.js', () => ({
  runInstallCommand: runInstallCommandMock,
}));

import { runServerInstallRemoteCommand } from './server-install-remote.js';

function makeSpawnProcess(stdoutText: string, exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  };

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write: vi.fn(),
    end: vi.fn(() => {
      process.nextTick(() => {
        if (stdoutText) {
          child.stdout.emit('data', Buffer.from(stdoutText));
        }
        child.emit('close', exitCode);
      });
    }),
  };

  return child;
}

describe('server install-remote command', () => {
  let originalDatabaseUrl: string | undefined;

  beforeEach(() => {
    originalDatabaseUrl = process.env['LGREP_DATABASE_URL'];
    process.env['LGREP_DATABASE_URL'] = 'postgres://postgres:postgres@example.com:5432/lgrep';

    spawnMock.mockReset();
    runInstallCommandMock.mockReset().mockResolvedValue({
      success: true,
      target: 'all',
      targetsApplied: ['claude', 'codex', 'mcp'],
      skillCreated: true,
      hookAdded: true,
      userClaudeMdUpdated: true,
      projectClaudeUpdated: false,
      codexUserUpdated: true,
      codexProjectUpdated: false,
      mcpConfigured: true,
      clientConfigUpdated: true,
      clientConfigPath: '/tmp/lgrep/config.json',
      userClaudeMdPath: '/Users/example/.claude/CLAUDE.md',
      codexUserPath: '/Users/example/.codex/AGENTS.md',
      mcpSettingsPath: '/Users/example/.claude/settings.json',
    });
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env['LGREP_DATABASE_URL'];
    } else {
      process.env['LGREP_DATABASE_URL'] = originalDatabaseUrl;
    }
  });

  it('provisions a remote host over SSH and configures the local machine globally', async () => {
    const child = makeSpawnProcess([
      'SERVICE_MANAGER=systemd-user',
      'SERVICE_PATH=/home/demo/.config/systemd/user/lgrep-server.service',
      'START_SCRIPT=/home/demo/.lgrep-server/lgrep-server/lgrep-server-start.sh',
      'TOKEN_FILE=/home/demo/.lgrep-server/lgrep-server/lgrep-server-tokens.json',
      'HEALTH_URL=http://127.0.0.1:8420/health',
    ].join('\n'));
    spawnMock.mockReturnValue(child);

    const result = await runServerInstallRemoteCommand({
      sshTarget: 'demo@example.com',
      serverUrl: 'https://lgrep.example.com',
    });

    expect(spawnMock).toHaveBeenCalledWith(
      'ssh',
      ['demo@example.com', 'sh', '-s'],
      expect.any(Object),
    );
    expect(child.stdin.write).toHaveBeenCalledTimes(1);

    const sentScript = child.stdin.write.mock.calls[0]?.[0] as string;
    expect(sentScript).toContain('ensure_remote_prerequisites');
    expect(sentScript).toContain('npm install -g');
    expect(sentScript).toContain('launchctl bootstrap');
    expect(sentScript).toContain('systemctl --user enable --now');
    expect(sentScript).toContain('tmux new-session -d -s "$SERVICE_NAME"');

    expect(runInstallCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      target: 'all',
      global: true,
      addToClaudeMd: true,
      serverUrl: 'https://lgrep.example.com',
      force: undefined,
    }));

    expect(result.success).toBe(true);
    expect(result.remote.serviceManager).toBe('systemd-user');
    expect(result.token.storedInClientConfig).toBe(true);
    expect(result.localInstall?.clientConfigPath).toBe('/tmp/lgrep/config.json');
  });

  it('can provision the remote host without touching the local machine', async () => {
    const child = makeSpawnProcess('SERVICE_MANAGER=launchd\nSERVICE_PATH=/Users/demo/Library/LaunchAgents/com.lgrep.lgrep-server.plist');
    spawnMock.mockReturnValue(child);

    const result = await runServerInstallRemoteCommand({
      sshTarget: 'mini.local',
      serverUrl: 'https://mini.example.com',
      skipLocalInstall: true,
    });

    expect(runInstallCommandMock).not.toHaveBeenCalled();
    expect(result.localInstall).toBeUndefined();
    expect(result.token.storedInClientConfig).toBe(false);
    expect(result.remote.serviceManager).toBe('launchd');
  });

  it('reports tmux fallback service management when no launchd or systemd is available', async () => {
    const child = makeSpawnProcess([
      'SERVICE_MANAGER=tmux',
      'SERVICE_PATH=lgrep-server',
      'START_SCRIPT=/root/.lgrep-server/lgrep-server/lgrep-server-start.sh',
      'TOKEN_FILE=/root/.lgrep-server/lgrep-server/lgrep-server-tokens.json',
      'HEALTH_URL=http://127.0.0.1:8420/health',
    ].join('\n'));
    spawnMock.mockReturnValue(child);

    const result = await runServerInstallRemoteCommand({
      sshTarget: 'docker@example.com',
      serverUrl: 'https://docker.example.com',
      skipLocalInstall: true,
    });

    expect(result.remote.serviceManager).toBe('tmux');
    expect(result.remote.servicePath).toBe('lgrep-server');
    expect(result.notes[0]).toContain('launchd/systemd/tmux');
  });
});
