import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerTokenRecord } from '../../server/auth.js';
import { runInstallCommand, type InstallResult, type InstallTarget } from './install.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_REMOTE_PROFILE = 'cloud';
const DEFAULT_SERVICE_NAME = 'lgrep-server';
const DEFAULT_PORT = 8420;

export interface ServerInstallRemoteOptions {
  sshTarget: string;
  serverUrl: string;
  databaseUrl?: string;
  databaseUrlEnv?: string;
  remoteProfile?: string;
  serviceName?: string;
  port?: number;
  tokenLabel?: string;
  installTarget?: InstallTarget;
  skipLocalInstall?: boolean;
  force?: boolean;
}

export interface ServerInstallRemoteResult {
  success: boolean;
  sshTarget: string;
  packageSpecifier: string;
  profile: string;
  port: number;
  serverUrl: string;
  token: {
    label: string;
    storedInClientConfig: boolean;
  };
  remote: {
    serviceName: string;
    serviceManager: string;
    servicePath: string;
    startScript: string;
    tokenFile: string;
    healthUrl: string;
  };
  localInstall?: InstallResult;
  notes: string[];
  error?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sanitizeServiceName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Service name cannot be empty');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error('Service name may contain only letters, numbers, dot, underscore, and hyphen');
  }
  return trimmed;
}

async function getPackageSpecifier(): Promise<string> {
  try {
    const packageJsonPath = join(__dirname, '..', '..', '..', 'package.json');
    const raw = await readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(raw) as { name?: string; version?: string };
    if (pkg.name && pkg.version) {
      return `${pkg.name}@${pkg.version}`;
    }
  } catch {
    // Fall back below.
  }

  return 'lgrep@latest';
}

function buildRemoteStartScript(options: {
  databaseUrl: string;
  port: number;
  remoteProfile: string;
  serviceName: string;
}): string {
  return [
    '#!/bin/sh',
    'set -eu',
    `export LGREP_PROFILE=${shellQuote(options.remoteProfile)}`,
    `export LGREP_DATABASE_URL=${shellQuote(options.databaseUrl)}`,
    `export LGREP_SERVER_TOKENS_FILE="$HOME/.lgrep-server/${options.serviceName}/${options.serviceName}-tokens.json"`,
    'NPM_PREFIX="$(npm prefix -g 2>/dev/null || true)"',
    'if [ -n "$NPM_PREFIX" ] && [ -d "$NPM_PREFIX/bin" ]; then',
    '  export PATH="$NPM_PREFIX/bin:$PATH"',
    'fi',
    'if ! command -v lgrep >/dev/null 2>&1; then',
    '  echo "lgrep binary not found after npm install -g" >&2',
    '  exit 1',
    'fi',
    `lgrep init --mode cloud --profile ${shellQuote(options.remoteProfile)} --database-url-env LGREP_DATABASE_URL --integrate none --skip-index --yes >/dev/null`,
    `exec lgrep server start --port ${shellQuote(String(options.port))}`,
  ].join('\n');
}

function buildRemoteProvisionScript(options: {
  packageSpecifier: string;
  serviceName: string;
  port: number;
  remoteProfile: string;
  tokenValue: string;
  startScriptContent: string;
  tokenFileContent: string;
}): string {
  const plistLabel = `com.lgrep.${options.serviceName}`;
  const plistName = `${plistLabel}.plist`;
  const userUnitName = `${options.serviceName}.service`;

  return [
    '#!/bin/sh',
    'set -eu',
    `SERVICE_NAME=${shellQuote(options.serviceName)}`,
    `PORT=${shellQuote(String(options.port))}`,
    `REMOTE_PROFILE=${shellQuote(options.remoteProfile)}`,
    `SERVER_ROOT="$HOME/.lgrep-server/${options.serviceName}"`,
    `START_SCRIPT="$SERVER_ROOT/${options.serviceName}-start.sh"`,
    `TOKEN_FILE="$SERVER_ROOT/${options.serviceName}-tokens.json"`,
    `START_LOG="$SERVER_ROOT/${options.serviceName}.out.log"`,
    `ERROR_LOG="$SERVER_ROOT/${options.serviceName}.err.log"`,
    'LOG_DIR="$SERVER_ROOT/logs"',
    'mkdir -p "$SERVER_ROOT" "$LOG_DIR"',
    'if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then',
    '  echo "ERROR: Node.js and npm are required on the remote host." >&2',
    '  exit 1',
    'fi',
    'ensure_remote_prerequisites() {',
    '  if [ "$(uname -s)" = "Darwin" ]; then',
    '    return',
    '  fi',
    '  NEEDS_INSTALL=0',
    '  if ! command -v make >/dev/null 2>&1; then',
    '    NEEDS_INSTALL=1',
    '  fi',
    '  if ! command -v python3 >/dev/null 2>&1; then',
    '    NEEDS_INSTALL=1',
    '  fi',
    '  if ! command -v c++ >/dev/null 2>&1 && ! command -v g++ >/dev/null 2>&1 && ! command -v clang++ >/dev/null 2>&1; then',
    '    NEEDS_INSTALL=1',
    '  fi',
    '  if ! command -v tmux >/dev/null 2>&1; then',
    '    NEEDS_INSTALL=1',
    '  fi',
    '  if ! command -v curl >/dev/null 2>&1; then',
    '    NEEDS_INSTALL=1',
    '  fi',
    '  if [ "$NEEDS_INSTALL" -eq 0 ]; then',
    '    return',
    '  fi',
    '  if command -v apt-get >/dev/null 2>&1; then',
    '    export DEBIAN_FRONTEND=noninteractive',
    '    apt-get update >/dev/null',
    '    apt-get install -y build-essential python3 curl tmux ca-certificates >/dev/null',
    '    return',
    '  fi',
    '  if command -v dnf >/dev/null 2>&1; then',
    '    dnf install -y gcc-c++ make python3 curl tmux ca-certificates >/dev/null',
    '    return',
    '  fi',
    '  if command -v yum >/dev/null 2>&1; then',
    '    yum install -y gcc-c++ make python3 curl tmux ca-certificates >/dev/null',
    '    return',
    '  fi',
    '  if command -v zypper >/dev/null 2>&1; then',
    '    zypper --non-interactive install gcc-c++ make python3 curl tmux ca-certificates >/dev/null',
    '    return',
    '  fi',
    '  if command -v apk >/dev/null 2>&1; then',
    '    apk add --no-cache build-base python3 curl tmux ca-certificates >/dev/null',
    '    return',
    '  fi',
    '  echo "ERROR: Missing build/runtime prerequisites and no supported package manager was found." >&2',
    '  exit 1',
    '}',
    'can_use_systemd_system() {',
    '  command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] && sudo -n true >/dev/null 2>&1',
    '}',
    'can_use_systemd_user() {',
    '  command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1',
    '}',
    'ensure_remote_prerequisites',
    `npm install -g ${shellQuote(options.packageSpecifier)}`,
    `cat > "$TOKEN_FILE" <<'__LGREP_TOKEN_FILE__'\n${options.tokenFileContent}\n__LGREP_TOKEN_FILE__`,
    `cat > "$START_SCRIPT" <<'__LGREP_START_SCRIPT__'\n${options.startScriptContent}\n__LGREP_START_SCRIPT__`,
    'chmod 700 "$START_SCRIPT"',
    'OS_NAME="$(uname -s)"',
    'SERVICE_MANAGER=""',
    'SERVICE_PATH=""',
    'if [ "$OS_NAME" = "Darwin" ]; then',
    '  mkdir -p "$HOME/Library/LaunchAgents"',
    `  PLIST_PATH="$HOME/Library/LaunchAgents/${plistName}"`,
    `  cat > "$PLIST_PATH" <<__LGREP_PLIST__
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$START_SCRIPT</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$START_LOG</string>
  <key>StandardErrorPath</key>
  <string>$ERROR_LOG</string>
</dict>
</plist>
__LGREP_PLIST__`,
    '  launchctl bootout "gui/$(id -u)/' + plistLabel + '" >/dev/null 2>&1 || true',
    '  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"',
    '  launchctl kickstart -k "gui/$(id -u)/' + plistLabel + '" >/dev/null 2>&1 || true',
    '  SERVICE_MANAGER="launchd"',
    '  SERVICE_PATH="$PLIST_PATH"',
    'elif can_use_systemd_system; then',
    `    UNIT_PATH="/etc/systemd/system/${userUnitName}"`,
    '    cat <<__LGREP_UNIT__ | sudo tee "$UNIT_PATH" >/dev/null',
    '[Unit]',
    'Description=lgrep hosted query service',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    'ExecStart=/bin/sh $START_SCRIPT',
    'Restart=always',
    'RestartSec=5',
    'WorkingDirectory=%h',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '__LGREP_UNIT__',
    `    sudo systemctl daemon-reload`,
    `    sudo systemctl enable --now ${shellQuote(userUnitName)}`,
    '    SERVICE_MANAGER="systemd"',
    '    SERVICE_PATH="$UNIT_PATH"',
    'elif can_use_systemd_user; then',
    '    mkdir -p "$HOME/.config/systemd/user"',
    `    UNIT_PATH="$HOME/.config/systemd/user/${userUnitName}"`,
    '    cat > "$UNIT_PATH" <<__LGREP_UNIT__',
    '[Unit]',
    'Description=lgrep hosted query service',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    'ExecStart=/bin/sh $START_SCRIPT',
    'Restart=always',
    'RestartSec=5',
    'WorkingDirectory=%h',
    '',
    '[Install]',
    'WantedBy=default.target',
    '__LGREP_UNIT__',
    '    systemctl --user daemon-reload',
    `    systemctl --user enable --now ${shellQuote(userUnitName)}`,
    '    if command -v loginctl >/dev/null 2>&1; then',
    '      loginctl enable-linger "$(whoami)" >/dev/null 2>&1 || true',
    '    fi',
    '    SERVICE_MANAGER="systemd-user"',
    '    SERVICE_PATH="$UNIT_PATH"',
    'elif command -v tmux >/dev/null 2>&1; then',
    '  tmux has-session -t "$SERVICE_NAME" >/dev/null 2>&1 && tmux kill-session -t "$SERVICE_NAME" >/dev/null 2>&1 || true',
    '  tmux new-session -d -s "$SERVICE_NAME" "exec /bin/sh \\"$START_SCRIPT\\" >> \\"$START_LOG\\" 2>> \\"$ERROR_LOG\\""',
    '  SERVICE_MANAGER="tmux"',
    '  SERVICE_PATH="$SERVICE_NAME"',
    'else',
    '  echo "ERROR: Supported service manager not found. Expected launchd, working systemd, or tmux." >&2',
    '  exit 1',
    'fi',
    'if command -v curl >/dev/null 2>&1; then',
    '  attempt=0',
    '  while [ "$attempt" -lt 20 ]; do',
    `    if curl -fsS -H "Authorization: Bearer ${options.tokenValue}" "http://127.0.0.1:${options.port}/health" >/dev/null 2>&1; then`,
    '      break',
    '    fi',
    '    attempt=$((attempt + 1))',
    '    sleep 1',
    '  done',
    '  if [ "$attempt" -ge 20 ]; then',
    '    echo "ERROR: lgrep server failed its localhost health check." >&2',
    '    exit 1',
    '  fi',
    'fi',
    'printf "SERVICE_MANAGER=%s\\n" "$SERVICE_MANAGER"',
    'printf "SERVICE_PATH=%s\\n" "$SERVICE_PATH"',
    'printf "START_SCRIPT=%s\\n" "$START_SCRIPT"',
    'printf "TOKEN_FILE=%s\\n" "$TOKEN_FILE"',
    `printf "HEALTH_URL=%s\\n" ${shellQuote(`http://127.0.0.1:${options.port}/health`)}`,
  ].join('\n');
}

function runScriptOverSsh(sshTarget: string, script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [sshTarget, 'sh', '-s'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `ssh exited with code ${code ?? 'unknown'}`));
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

function parseRemoteSummary(stdout: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    const key = match?.[1];
    const value = match?.[2];
    if (key && value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}

export async function runServerInstallRemoteCommand(
  options: ServerInstallRemoteOptions,
): Promise<ServerInstallRemoteResult> {
  const sshTarget = options.sshTarget.trim();
  if (!sshTarget) {
    throw new Error('SSH target is required');
  }

  const databaseUrl = options.databaseUrl?.trim() || process.env[options.databaseUrlEnv?.trim() || 'LGREP_DATABASE_URL']?.trim();
  if (!databaseUrl) {
    throw new Error(`Missing database URL. Pass --database-url or export ${options.databaseUrlEnv?.trim() || 'LGREP_DATABASE_URL'}.`);
  }

  const serverUrl = options.serverUrl.trim();
  const serviceName = sanitizeServiceName(options.serviceName || DEFAULT_SERVICE_NAME);
  const remoteProfile = options.remoteProfile?.trim() || DEFAULT_REMOTE_PROFILE;
  const port = options.port ?? DEFAULT_PORT;
  const tokenLabel = options.tokenLabel?.trim() || `${serviceName} remote client`;
  const installTarget = options.installTarget || 'all';
  const packageSpecifier = await getPackageSpecifier();

  const remoteRoot = `$HOME/.lgrep-server/${serviceName}`;
  const startScriptPath = `${remoteRoot}/${serviceName}-start.sh`;
  const tokenFilePath = `${remoteRoot}/${serviceName}-tokens.json`;

  const tokenRecord = createServerTokenRecord({
    label: tokenLabel,
    projects: null,
    worktrees: null,
  });

  const startScript = buildRemoteStartScript({
    databaseUrl,
    port,
    remoteProfile,
    serviceName,
  });
  const remoteScript = buildRemoteProvisionScript({
    packageSpecifier,
    serviceName,
    port,
    remoteProfile,
    tokenValue: tokenRecord.token,
    startScriptContent: startScript,
    tokenFileContent: JSON.stringify({ tokens: [tokenRecord.storedToken] }, null, 2),
  });

  const stdout = await runScriptOverSsh(sshTarget, remoteScript);
  const summary = parseRemoteSummary(stdout);

  let localInstall: InstallResult | undefined;
  if (!options.skipLocalInstall) {
    localInstall = await runInstallCommand({
      target: installTarget,
      global: true,
      addToClaudeMd: true,
      force: options.force,
      serverUrl,
      serverAuthToken: tokenRecord.token,
    });

    if (!localInstall.success) {
      throw new Error(localInstall.error || 'Remote server installed, but local client setup failed');
    }
  }

  return {
    success: true,
    sshTarget,
    packageSpecifier,
    profile: remoteProfile,
    port,
    serverUrl,
    token: {
      label: tokenLabel,
      storedInClientConfig: !options.skipLocalInstall,
    },
    remote: {
      serviceName,
      serviceManager: summary['SERVICE_MANAGER'] || 'unknown',
      servicePath: summary['SERVICE_PATH'] || '',
      startScript: summary['START_SCRIPT'] || startScriptPath,
      tokenFile: summary['TOKEN_FILE'] || tokenFilePath,
      healthUrl: summary['HEALTH_URL'] || `http://127.0.0.1:${port}/health`,
    },
    localInstall,
    notes: [
      'The remote host now serves the hosted query layer over SSH-provisioned launchd/systemd/tmux.',
      options.skipLocalInstall
        ? 'Local client install was skipped, so no Claude/Codex/MCP files were changed on this machine.'
        : 'This machine now has a persisted hosted server URL and bearer token in the active lgrep profile.',
      'Use `lgrep server bootstrap /path/to/repo --project <name> --branch <branch> --server-url <url>` to register a repo and its worktrees against the hosted database.',
    ],
  };
}
