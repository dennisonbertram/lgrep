import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getIndex, listIndexes } from '../../storage/lance.js';
import { openConfiguredDatabase } from '../../storage/database-config.js';
import { getConfigPath, getLgrepHome } from '../utils/paths.js';
import { loadConfig } from '../../storage/config.js';
import { DaemonManager } from '../../daemon/manager.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import {
  DEFAULT_PROFILE_NAME,
  getActiveProfileName,
  isExplicitLgrepHome,
} from '../utils/profiles.js';

const execAsync = promisify(exec);
const LGREP_SECTION_MARKER = '<!-- LGREP START -->';

export interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface DoctorResult {
  success: boolean;
  checks: CheckResult[];
  summary: {
    ok: number;
    warn: number;
    error: number;
  };
}

export interface DoctorOptions {
  json?: boolean;
  path?: string;
}

interface ClaudeSettings {
  hooks?: {
    SessionStart?: Array<{
      matcher?: string;
      hooks?: Array<{ command?: string }>;
    }>;
  };
  mcpServers?: Record<string, unknown>;
}

function readClaudeSettings(home: string): ClaudeSettings | null {
  try {
    const settingsPath = join(home, '.claude', 'settings.json');
    if (!existsSync(settingsPath)) {
      return null;
    }
    return JSON.parse(readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
  } catch {
    return null;
  }
}

function findNearestFile(startPath: string, fileName: string): string | null {
  let current = resolve(startPath);
  while (true) {
    const candidate = join(current, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function checkProfile(): Promise<CheckResult> {
  if (isExplicitLgrepHome()) {
    return {
      name: 'Active profile',
      status: 'warn',
      message: `LGREP_HOME override in use (${getLgrepHome()})`,
      fix: 'Unset LGREP_HOME to use named profiles',
    };
  }

  const profile = getActiveProfileName();
  const profileHome = getLgrepHome();
  return {
    name: 'Active profile',
    status: 'ok',
    message: profile === DEFAULT_PROFILE_NAME
      ? `default (${profileHome})`
      : `${profile} (${profileHome})`,
  };
}

async function checkOllama(): Promise<CheckResult> {
  try {
    await execAsync('which ollama');
  } catch {
    return {
      name: 'Ollama installed',
      status: 'warn',
      message: 'Ollama not installed (optional if using external embeddings)',
      fix: 'Run: lgrep init',
    };
  }

  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      return {
        name: 'Ollama running',
        status: 'ok',
        message: 'Ollama is running on localhost:11434',
      };
    }
  } catch {
    // Not running.
  }

  return {
    name: 'Ollama running',
    status: 'warn',
    message: 'Ollama installed but not running',
    fix: 'Run: ollama serve',
  };
}

async function checkEmbeddingProvider(): Promise<CheckResult> {
  const config = await loadConfig();
  const model = config.model || 'auto';

  const hasOpenAI = !!process.env['OPENAI_API_KEY'];
  const hasCohere = !!process.env['COHERE_API_KEY'];
  const hasVoyage = !!process.env['VOYAGE_API_KEY'];
  const hasCloudProvider = hasOpenAI || hasCohere || hasVoyage;

  let ollamaRunning = false;
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    ollamaRunning = response.ok;
  } catch {
    // Ignore.
  }

  if (model === 'auto') {
    if (hasCloudProvider) {
      const provider = hasOpenAI ? 'OpenAI' : hasCohere ? 'Cohere' : 'Voyage';
      return {
        name: 'Embedding provider',
        status: 'ok',
        message: `Auto-detect will use ${provider} (API key found)`,
      };
    }
    if (ollamaRunning) {
      return {
        name: 'Embedding provider',
        status: 'ok',
        message: 'Auto-detect will use Ollama (local)',
      };
    }

    return {
      name: 'Embedding provider',
      status: 'error',
      message: 'No embedding provider available',
      fix: 'Run: lgrep init',
    };
  }

  if (model.startsWith('openai:') && !hasOpenAI) {
    return {
      name: 'Embedding provider',
      status: 'error',
      message: `Model "${model}" requires OPENAI_API_KEY`,
      fix: 'Export OPENAI_API_KEY or run: lgrep init',
    };
  }
  if (model.startsWith('cohere:') && !hasCohere) {
    return {
      name: 'Embedding provider',
      status: 'error',
      message: `Model "${model}" requires COHERE_API_KEY`,
      fix: 'Export COHERE_API_KEY or run: lgrep init',
    };
  }
  if (model.startsWith('voyage:') && !hasVoyage) {
    return {
      name: 'Embedding provider',
      status: 'error',
      message: `Model "${model}" requires VOYAGE_API_KEY`,
      fix: 'Export VOYAGE_API_KEY or run: lgrep init',
    };
  }

  return {
    name: 'Embedding provider',
    status: 'ok',
    message: `Configured: ${model}`,
  };
}

function checkLgrepHome(): CheckResult {
  const home = getLgrepHome();
  if (existsSync(home)) {
    return {
      name: 'lgrep home',
      status: 'ok',
      message: home,
    };
  }
  return {
    name: 'lgrep home',
    status: 'warn',
    message: `Directory doesn't exist yet: ${home}`,
    fix: 'Run: lgrep init',
  };
}

function checkConfig(): CheckResult {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    return {
      name: 'Config file',
      status: 'ok',
      message: configPath,
    };
  }
  return {
    name: 'Config file',
    status: 'warn',
    message: 'No config file (using defaults)',
    fix: 'Run: lgrep init',
  };
}

async function checkStorageBackend(): Promise<CheckResult> {
  const config = await loadConfig();
  if (config.storageMode === 'local') {
    return {
      name: 'Storage backend',
      status: 'ok',
      message: 'Local index + local cache',
    };
  }

  if (config.storageMode === 'postgres') {
    return {
      name: 'Storage backend',
      status: 'ok',
      message: `Cloud Postgres using ${config.storageDatabaseUrlEnv}`,
    };
  }

  return {
    name: 'Storage backend',
    status: 'warn',
    message: `Advanced S3/R2 mode (${config.storageUri || 'unconfigured'})`,
    fix: 'Run: lgrep init --mode cloud to switch to the default Postgres cloud path',
  };
}

async function checkCloudDatabase(): Promise<CheckResult | null> {
  const config = await loadConfig();
  if (config.storageMode !== 'postgres') {
    return null;
  }

  const envName = config.storageDatabaseUrlEnv.trim() || 'LGREP_DATABASE_URL';
  const databaseUrl = process.env[envName];
  if (!databaseUrl) {
    return {
      name: 'Cloud database',
      status: 'error',
      message: `Missing ${envName}`,
      fix: `Export ${envName} or rerun: lgrep init --mode cloud`,
    };
  }

  try {
    const db = await openConfiguredDatabase();
    await db.close();

    return {
      name: 'Cloud database',
      status: 'ok',
      message: `Connected via ${envName}; pgvector and schema are ready`,
    };
  } catch (error) {
    return {
      name: 'Cloud database',
      status: 'error',
      message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      fix: `Verify ${envName} and database connectivity, then rerun lgrep doctor`,
    };
  }
}

async function checkRemoteCache(): Promise<CheckResult | null> {
  const config = await loadConfig();
  if (config.cacheBackend !== 'postgres') {
    return null;
  }

  const envName = config.cacheDatabaseUrlEnv.trim() || 'LGREP_CACHE_DATABASE_URL';
  if (!process.env[envName]) {
    return {
      name: 'Remote cache',
      status: 'error',
      message: `Missing ${envName}`,
      fix: `Export ${envName} or switch cacheBackend to local`,
    };
  }

  return {
    name: 'Remote cache',
    status: 'ok',
    message: `Remote cache configured via ${envName}`,
  };
}

async function checkIndexes(): Promise<CheckResult> {
  const config = await loadConfig();

  try {
    const db = await openConfiguredDatabase();
    try {
      const indexes = await listIndexes(db);
      if (indexes.length === 0) {
        return {
          name: 'Indexes',
          status: 'warn',
          message: config.storageMode === 'local' ? 'No indexes created yet' : 'No indexes found',
          fix: 'Run: lgrep index . --name <name>',
        };
      }

      return {
        name: 'Indexes',
        status: 'ok',
        message: `${indexes.length} index(es): ${indexes.map((index) => index.name).join(', ')}`,
      };
    } finally {
      await db.close();
    }
  } catch (error) {
    return {
      name: 'Indexes',
      status: config.storageMode === 'local' ? 'warn' : 'error',
      message: `Unavailable: ${error instanceof Error ? error.message : String(error)}`,
      fix: config.storageMode === 'local' ? 'Run: lgrep init' : 'Fix the cloud database configuration, then rerun lgrep doctor',
    };
  }
}

async function checkCurrentDirectory(targetPath: string): Promise<CheckResult> {
  const absolutePath = resolve(targetPath);
  const dirName = basename(absolutePath);

  try {
    const detected = await detectIndexForDirectory(absolutePath);
    if (detected) {
      return {
        name: 'Current directory',
        status: 'ok',
        message: `Indexed as "${detected}"`,
      };
    }
  } catch {
    // Detection failed.
  }

  try {
    const db = await openConfiguredDatabase();
    try {
      const index = await getIndex(db, dirName);
      if (index) {
        return {
          name: 'Current directory',
          status: 'ok',
          message: `Indexed as "${dirName}"`,
        };
      }
    } finally {
      await db.close();
    }
  } catch (error) {
    return {
      name: 'Current directory',
      status: 'warn',
      message: `Index detection unavailable: ${error instanceof Error ? error.message : String(error)}`,
      fix: 'Run: lgrep doctor after fixing storage configuration',
    };
  }

  return {
    name: 'Current directory',
    status: 'warn',
    message: `Not indexed: ${absolutePath}`,
    fix: `Run: lgrep index "${absolutePath}" --name <name>`,
  };
}

async function checkWatcher(targetPath: string): Promise<CheckResult> {
  const config = await loadConfig();
  if (config.storageMode !== 'local') {
    return {
      name: 'Watcher daemon',
      status: 'ok',
      message: 'Cloud mode does not require local watchers',
    };
  }

  const absolutePath = resolve(targetPath);
  const dirName = basename(absolutePath);
  const manager = new DaemonManager();
  const daemons = await manager.list();

  const matchingDaemon = daemons.find(
    (daemon) => daemon.rootPath === absolutePath || daemon.indexName === dirName
  );

  if (matchingDaemon) {
    return {
      name: 'Watcher daemon',
      status: 'ok',
      message: `Running (PID ${matchingDaemon.pid}) as "${matchingDaemon.indexName}"`,
    };
  }

  if (daemons.length === 0) {
    return {
      name: 'Watcher daemon',
      status: 'warn',
      message: 'No watchers running',
      fix: `Run: lgrep watch "${absolutePath}"`,
    };
  }

  return {
    name: 'Watcher daemon',
    status: 'warn',
    message: `No watcher for this directory (${daemons.length} other watcher(s) running)`,
    fix: `Run: lgrep watch "${absolutePath}"`,
  };
}

function checkClaudeIntegration(): CheckResult {
  const home = process.env['HOME'] || '';
  const skillPath = join(home, '.claude', 'skills', 'lgrep-search', 'SKILL.md');
  const settings = readClaudeSettings(home);
  const hasSkill = existsSync(skillPath);
  const hasHook = Boolean(
    settings?.hooks?.SessionStart?.some((entry) =>
      entry.hooks?.some((hook) => hook.command?.includes('lgrep-check.sh'))
    )
  );

  if (hasSkill && hasHook) {
    return {
      name: 'Claude integration',
      status: 'ok',
      message: 'Skill and SessionStart hook installed',
    };
  }

  if (hasSkill) {
    return {
      name: 'Claude integration',
      status: 'warn',
      message: 'Skill installed, but SessionStart hook missing',
      fix: 'Run: lgrep install --target claude',
    };
  }

  return {
    name: 'Claude integration',
    status: 'warn',
    message: 'Not installed',
    fix: 'Run: lgrep install --target claude',
  };
}

function checkCodexIntegration(targetPath: string): CheckResult {
  const agentsPath = findNearestFile(targetPath, 'AGENTS.md');
  if (!agentsPath) {
    return {
      name: 'Codex integration',
      status: 'warn',
      message: 'No AGENTS.md found for this project',
      fix: 'Run: lgrep install --target codex',
    };
  }

  try {
    const content = readFileSync(agentsPath, 'utf-8');
    if (content.includes(LGREP_SECTION_MARKER) || content.includes('## lgrep') || content.includes('# lgrep')) {
      return {
        name: 'Codex integration',
        status: 'ok',
        message: `Project guidance installed at ${agentsPath}`,
      };
    }
  } catch {
    // Ignore read failures and fall through.
  }

  return {
    name: 'Codex integration',
    status: 'warn',
    message: `AGENTS.md found at ${agentsPath}, but lgrep guidance is missing`,
    fix: 'Run: lgrep install --target codex',
  };
}

function checkMcpIntegration(): CheckResult {
  const home = process.env['HOME'] || '';
  const settings = readClaudeSettings(home);
  if (settings?.mcpServers && 'lgrep' in settings.mcpServers) {
    return {
      name: 'MCP integration',
      status: 'ok',
      message: 'lgrep MCP server is configured',
    };
  }

  return {
    name: 'MCP integration',
    status: 'warn',
    message: 'Not configured',
    fix: 'Run: lgrep install --target mcp',
  };
}

async function checkZombieIndexes(): Promise<CheckResult> {
  try {
    const db = await openConfiguredDatabase();
    try {
      const indexes = await listIndexes(db);
      const zombieIndexes = indexes.filter(
        (index) => index.metadata.status === 'building' && index.metadata.chunkCount === 0
      );

      if (zombieIndexes.length === 0) {
        return {
          name: 'Zombie indexes',
          status: 'ok',
          message: 'No zombie indexes detected',
        };
      }

      const zombieNames = zombieIndexes.map((index) => index.name).join(', ');
      return {
        name: 'Zombie indexes',
        status: 'warn',
        message: `${zombieIndexes.length} index(es) stuck in building state: ${zombieNames}`,
        fix: 'Run: lgrep clean',
      };
    } finally {
      await db.close();
    }
  } catch (error) {
    return {
      name: 'Zombie indexes',
      status: 'warn',
      message: `Unavailable: ${error instanceof Error ? error.message : String(error)}`,
      fix: 'Fix storage configuration, then rerun lgrep doctor',
    };
  }
}

export async function runDoctorCommand(options: DoctorOptions = {}): Promise<DoctorResult> {
  const targetPath = options.path || process.cwd();
  const checks: CheckResult[] = [];

  checks.push(await checkProfile());
  checks.push(checkLgrepHome());
  checks.push(checkConfig());
  checks.push(await checkStorageBackend());
  checks.push(await checkOllama());
  checks.push(await checkEmbeddingProvider());

  const cloudDatabaseCheck = await checkCloudDatabase();
  if (cloudDatabaseCheck) {
    checks.push(cloudDatabaseCheck);
  }

  const remoteCacheCheck = await checkRemoteCache();
  if (remoteCacheCheck) {
    checks.push(remoteCacheCheck);
  }

  checks.push(await checkIndexes());
  checks.push(await checkZombieIndexes());
  checks.push(await checkCurrentDirectory(targetPath));
  checks.push(await checkWatcher(targetPath));
  checks.push(checkClaudeIntegration());
  checks.push(checkCodexIntegration(targetPath));
  checks.push(checkMcpIntegration());

  const summary = {
    ok: checks.filter((check) => check.status === 'ok').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    error: checks.filter((check) => check.status === 'error').length,
  };

  return {
    success: summary.error === 0,
    checks,
    summary,
  };
}
