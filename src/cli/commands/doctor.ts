import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { openDatabase, getIndex, listIndexes } from '../../storage/lance.js';
import { getDbPath, getLgrepHome, getConfigPath } from '../utils/paths.js';
import { loadConfig } from '../../storage/config.js';
import { DaemonManager } from '../../daemon/manager.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';

const execAsync = promisify(exec);

/**
 * Check result for a single item.
 */
export interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

/**
 * Overall doctor result.
 */
export interface DoctorResult {
  success: boolean;
  checks: CheckResult[];
  summary: {
    ok: number;
    warn: number;
    error: number;
  };
}

/**
 * Options for doctor command.
 */
export interface DoctorOptions {
  json?: boolean;
  path?: string;
}

/**
 * Check if Ollama is installed and running.
 */
async function checkOllama(): Promise<CheckResult> {
  try {
    await execAsync('which ollama');
  } catch {
    return {
      name: 'Ollama installed',
      status: 'warn',
      message: 'Ollama not installed (optional if using cloud embeddings)',
      fix: 'Run: lgrep setup',
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
    // Not running
  }

  return {
    name: 'Ollama running',
    status: 'warn',
    message: 'Ollama installed but not running',
    fix: 'Run: ollama serve',
  };
}

/**
 * Check embedding provider configuration.
 */
async function checkEmbeddingProvider(): Promise<CheckResult> {
  const config = await loadConfig();
  const model = config.model || 'auto';

  // Check for API keys
  const hasOpenAI = !!process.env['OPENAI_API_KEY'];
  const hasCohere = !!process.env['COHERE_API_KEY'];
  const hasVoyage = !!process.env['VOYAGE_API_KEY'];
  const hasCloudProvider = hasOpenAI || hasCohere || hasVoyage;

  // Check for Ollama
  let ollamaRunning = false;
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    ollamaRunning = response.ok;
  } catch {
    // Not running
  }

  if (model === 'auto') {
    if (hasCloudProvider) {
      const provider = hasOpenAI ? 'OpenAI' : hasCohere ? 'Cohere' : 'Voyage';
      return {
        name: 'Embedding provider',
        status: 'ok',
        message: `Auto-detect will use ${provider} (API key found)`,
      };
    } else if (ollamaRunning) {
      return {
        name: 'Embedding provider',
        status: 'ok',
        message: 'Auto-detect will use Ollama (local)',
      };
    } else {
      return {
        name: 'Embedding provider',
        status: 'error',
        message: 'No embedding provider available',
        fix: 'Set OPENAI_API_KEY or run: ollama serve',
      };
    }
  }

  // Explicit model configured
  if (model.startsWith('openai:') && !hasOpenAI) {
    return {
      name: 'Embedding provider',
      status: 'error',
      message: `Model "${model}" requires OPENAI_API_KEY`,
      fix: 'export OPENAI_API_KEY="sk-..."',
    };
  }
  if (model.startsWith('cohere:') && !hasCohere) {
    return {
      name: 'Embedding provider',
      status: 'error',
      message: `Model "${model}" requires COHERE_API_KEY`,
      fix: 'export COHERE_API_KEY="..."',
    };
  }
  if (model.startsWith('voyage:') && !hasVoyage) {
    return {
      name: 'Embedding provider',
      status: 'error',
      message: `Model "${model}" requires VOYAGE_API_KEY`,
      fix: 'export VOYAGE_API_KEY="..."',
    };
  }

  return {
    name: 'Embedding provider',
    status: 'ok',
    message: `Configured: ${model}`,
  };
}

/**
 * Check if lgrep home directory exists.
 */
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
    fix: 'Run: lgrep index <path> --name <name>',
  };
}

/**
 * Check if config file exists.
 */
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
    fix: 'Run: lgrep config set model auto',
  };
}

/**
 * Check indexes.
 */
async function checkIndexes(): Promise<CheckResult> {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    return {
      name: 'Indexes',
      status: 'warn',
      message: 'No indexes created yet',
      fix: 'Run: lgrep index . --name <name>',
    };
  }

  try {
    const db = await openDatabase(dbPath);
    const indexes = await listIndexes(db);
    await db.close();

    if (indexes.length === 0) {
      return {
        name: 'Indexes',
        status: 'warn',
        message: 'No indexes found',
        fix: 'Run: lgrep index . --name <name>',
      };
    }

    return {
      name: 'Indexes',
      status: 'ok',
      message: `${indexes.length} index(es): ${indexes.map(i => i.name).join(', ')}`,
    };
  } catch (error) {
    return {
      name: 'Indexes',
      status: 'error',
      message: `Failed to read indexes: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check if current directory is indexed.
 */
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
    // Detection failed
  }

  // Try to find by name
  const dbPath = getDbPath();
  if (existsSync(dbPath)) {
    try {
      const db = await openDatabase(dbPath);
      const index = await getIndex(db, dirName);
      await db.close();

      if (index) {
        return {
          name: 'Current directory',
          status: 'ok',
          message: `Indexed as "${dirName}"`,
        };
      }
    } catch {
      // Ignore
    }
  }

  return {
    name: 'Current directory',
    status: 'warn',
    message: `Not indexed: ${absolutePath}`,
    fix: `Run: lgrep watch "${absolutePath}"`,
  };
}

/**
 * Check if watcher is running for current directory.
 */
async function checkWatcher(targetPath: string): Promise<CheckResult> {
  const absolutePath = resolve(targetPath);
  const dirName = basename(absolutePath);

  const manager = new DaemonManager();
  const daemons = await manager.list();

  // Check if any daemon is watching this path
  const matchingDaemon = daemons.find(
    d => d.rootPath === absolutePath || d.indexName === dirName
  );

  if (matchingDaemon) {
    return {
      name: 'Watcher daemon',
      status: 'ok',
      message: `Running (PID ${matchingDaemon.pid}) as "${matchingDaemon.indexName}"`,
    };
  }

  // Check if there are any daemons at all
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

/**
 * Check Claude integration.
 */
function checkClaudeIntegration(): CheckResult {
  const home = process.env['HOME'] || '';
  const skillPath = `${home}/.claude/skills/lgrep-search/SKILL.md`;
  const claudeMdPath = `${home}/.claude/CLAUDE.md`;

  const hasSkill = existsSync(skillPath);
  const hasClaudeMd = existsSync(claudeMdPath);

  if (hasSkill && hasClaudeMd) {
    return {
      name: 'Claude integration',
      status: 'ok',
      message: 'Skill and CLAUDE.md installed',
    };
  }

  if (hasSkill) {
    return {
      name: 'Claude integration',
      status: 'warn',
      message: 'Skill installed, but ~/.claude/CLAUDE.md missing',
      fix: 'Run: lgrep install -y',
    };
  }

  return {
    name: 'Claude integration',
    status: 'warn',
    message: 'Not installed',
    fix: 'Run: lgrep install',
  };
}

/**
 * Check for zombie indexes (indexes stuck in "building" state).
 * These occur when indexing processes crash or are killed.
 */
async function checkZombieIndexes(): Promise<CheckResult> {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    return {
      name: 'Zombie indexes',
      status: 'ok',
      message: 'No indexes to check',
    };
  }

  try {
    const db = await openDatabase(dbPath);
    const indexes = await listIndexes(db);
    await db.close();

    // Find indexes stuck in "building" state with 0 chunks
    const zombieIndexes = indexes.filter(
      index => index.metadata.status === 'building' && index.metadata.chunkCount === 0
    );

    if (zombieIndexes.length === 0) {
      return {
        name: 'Zombie indexes',
        status: 'ok',
        message: 'No zombie indexes detected',
      };
    }

    const zombieNames = zombieIndexes.map(i => i.name).join(', ');
    return {
      name: 'Zombie indexes',
      status: 'warn',
      message: `${zombieIndexes.length} index(es) stuck in building state: ${zombieNames}`,
      fix: 'Run: lgrep clean',
    };
  } catch (error) {
    return {
      name: 'Zombie indexes',
      status: 'error',
      message: `Failed to check for zombie indexes: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Run the doctor command.
 */
export async function runDoctorCommand(options: DoctorOptions = {}): Promise<DoctorResult> {
  const targetPath = options.path || process.cwd();
  const checks: CheckResult[] = [];

  // Run all checks
  checks.push(checkLgrepHome());
  checks.push(checkConfig());
  checks.push(await checkOllama());
  checks.push(await checkEmbeddingProvider());
  checks.push(await checkIndexes());
  checks.push(await checkZombieIndexes());
  checks.push(await checkCurrentDirectory(targetPath));
  checks.push(await checkWatcher(targetPath));
  checks.push(checkClaudeIntegration());

  // Calculate summary
  const summary = {
    ok: checks.filter(c => c.status === 'ok').length,
    warn: checks.filter(c => c.status === 'warn').length,
    error: checks.filter(c => c.status === 'error').length,
  };

  return {
    success: summary.error === 0,
    checks,
    summary,
  };
}
