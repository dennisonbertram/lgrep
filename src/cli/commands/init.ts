import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as readline from 'node:readline';
import { loadConfig, saveConfig } from '../../storage/config.js';
import { openConfiguredDatabase } from '../../storage/database-config.js';
import { listIndexes } from '../../storage/lance.js';
import { checkOllamaInstalled, checkOllamaRunning } from '../../core/ollama-setup.js';
import { runIndexCommand } from './index.js';
import { runInstallCommand, type InstallTarget } from './install.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import {
  DEFAULT_PROFILE_NAME,
  createProfile,
  getActiveProfileName,
  getProfileHome,
  setActiveProfileName,
} from '../utils/profiles.js';

export interface InitOptions {
  mode?: 'local' | 'cloud';
  profile?: string;
  embedding?: 'auto' | 'openai' | 'ollama';
  integration?: InstallTarget | 'none';
  databaseUrlEnv?: string;
  databaseUrl?: string;
  indexCurrent?: boolean;
  skipIndex?: boolean;
  yes?: boolean;
  json?: boolean;
  cwd?: string;
}

export interface InitResult {
  success: boolean;
  mode: 'local' | 'cloud';
  profile: string;
  profileCreated: boolean;
  configPath: string;
  integration: InstallTarget | 'none';
  indexName?: string;
  indexAction?: 'created' | 'updated' | 'skipped';
  notes: string[];
  verificationCommands: string[];
  error?: string;
}

interface Prompt {
  close(): void;
  ask(question: string): Promise<string>;
}

function ensureCanPrompt(options: InitOptions, flagHelp: string): void {
  if (options.yes) {
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Non-interactive setup requires ${flagHelp}, or pass --yes to accept defaults.`);
  }
}

function createPrompt(): Prompt {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    close() {
      rl.close();
    },
    ask(question: string) {
      return new Promise((resolveAnswer) => {
        rl.question(question, (answer) => resolveAnswer(answer.trim()));
      });
    },
  };
}

async function chooseMode(prompt: Prompt, options: InitOptions): Promise<'local' | 'cloud'> {
  if (options.mode) {
    return options.mode;
  }
  if (options.yes) {
    return 'local';
  }
  ensureCanPrompt(options, '--mode');

  const answer = (await prompt.ask('Choose storage mode: [1] Local [2] Cloud (default 1): ')).toLowerCase();
  return answer === '2' || answer === 'cloud' ? 'cloud' : 'local';
}

async function chooseEmbedding(prompt: Prompt, options: InitOptions): Promise<'auto' | 'openai' | 'ollama'> {
  if (options.embedding) {
    return options.embedding;
  }
  if (options.yes) {
    return 'auto';
  }
  ensureCanPrompt(options, '--embedding');

  const answer = (await prompt.ask('Choose local embedding mode: [1] Auto [2] OpenAI [3] Ollama (default 1): ')).toLowerCase();
  if (answer === '2' || answer === 'openai') {
    return 'openai';
  }
  if (answer === '3' || answer === 'ollama') {
    return 'ollama';
  }
  return 'auto';
}

async function chooseIntegration(prompt: Prompt, options: InitOptions): Promise<InstallTarget | 'none'> {
  if (options.integration) {
    return options.integration;
  }
  if (options.yes) {
    return 'all';
  }
  ensureCanPrompt(options, '--integrate');

  const answer = (await prompt.ask('Install agent integration: [1] None [2] Claude [3] Codex [4] MCP [5] All (default 5): ')).toLowerCase();
  switch (answer) {
    case '1':
    case 'none':
      return 'none';
    case '2':
    case 'claude':
      return 'claude';
    case '3':
    case 'codex':
      return 'codex';
    case '4':
    case 'mcp':
      return 'mcp';
    default:
      return 'all';
  }
}

async function chooseIndexCurrent(prompt: Prompt, options: InitOptions): Promise<boolean> {
  if (options.skipIndex) {
    return false;
  }
  if (options.indexCurrent !== undefined) {
    return options.indexCurrent;
  }
  if (options.yes) {
    return true;
  }
  ensureCanPrompt(options, '--index-current/--skip-index');

  const answer = (await prompt.ask('Index the current directory now? [Y/n]: ')).toLowerCase();
  return answer !== 'n' && answer !== 'no';
}

function resolveProfileName(mode: 'local' | 'cloud', options: InitOptions, currentConfig: Awaited<ReturnType<typeof loadConfig>>): string {
  if (options.profile) {
    return options.profile;
  }

  const activeProfile = getActiveProfileName();
  if (activeProfile === DEFAULT_PROFILE_NAME) {
    if (mode === 'local' && currentConfig.storageMode === 'local' && (existsSync(getProfileHome(DEFAULT_PROFILE_NAME)) || existsSync(resolve(getProfileHome(DEFAULT_PROFILE_NAME), 'config.json')))) {
      return DEFAULT_PROFILE_NAME;
    }
    if (mode === 'cloud' && currentConfig.storageMode === 'postgres') {
      return DEFAULT_PROFILE_NAME;
    }
  }

  return mode;
}

function modelForEmbeddingChoice(choice: 'auto' | 'openai' | 'ollama'): string {
  switch (choice) {
    case 'openai':
      return 'openai:text-embedding-3-small';
    case 'ollama':
      return 'ollama:mxbai-embed-large';
    default:
      return 'auto';
  }
}

async function validateLocalIndexPrerequisites(model: string, notes: string[]): Promise<boolean> {
  if (model.startsWith('openai:') && !process.env['OPENAI_API_KEY']) {
    notes.push('Set OPENAI_API_KEY before indexing with the OpenAI embedding profile.');
    return false;
  }

  if (model.startsWith('ollama:')) {
    const installed = await checkOllamaInstalled();
    const running = installed ? await checkOllamaRunning() : false;
    if (!running) {
      notes.push('Start Ollama with `ollama serve` before indexing with the Ollama embedding profile.');
      return false;
    }
  }

  return true;
}

function makeIndexName(sourcePath: string, profile: string, takenNames: Set<string>): string {
  const base = basename(sourcePath);
  if (!takenNames.has(base)) {
    return base;
  }

  const profileName = profile === DEFAULT_PROFILE_NAME ? `${base}-local` : `${base}-${profile}`;
  if (!takenNames.has(profileName)) {
    return profileName;
  }

  const digest = createHash('sha1').update(sourcePath).digest('hex').slice(0, 8);
  return `${base}-${digest}`;
}

async function maybeIndexCurrentDirectory(
  cwd: string,
  profile: string,
  mode: 'local' | 'cloud',
  notes: string[],
): Promise<{ indexName?: string; action: 'created' | 'updated' | 'skipped' }> {
  if (mode === 'cloud') {
    const config = await loadConfig();
    const envName = config.storageDatabaseUrlEnv;
    if (!process.env[envName]) {
      notes.push(`Set ${envName} before indexing in cloud mode.`);
      return { action: 'skipped' };
    }
  }

  const config = await loadConfig();
  if (!(await validateLocalIndexPrerequisites(config.model, notes))) {
    return { action: 'skipped' };
  }

  const detected = await detectIndexForDirectory(cwd);
  if (detected) {
    await runIndexCommand(cwd, {
      name: detected,
      mode: 'update',
      showProgress: true,
      summarize: false,
    });
    return { indexName: detected, action: 'updated' };
  }

  const db = await openConfiguredDatabase();
  try {
    const indexes = await listIndexes(db);
    const indexName = makeIndexName(cwd, profile, new Set(indexes.map((index) => index.name)));
    await runIndexCommand(cwd, {
      name: indexName,
      mode: 'create',
      showProgress: true,
      summarize: false,
    });
    return { indexName, action: 'created' };
  } finally {
    await db.close();
  }
}

export async function runInitCommand(options: InitOptions = {}): Promise<InitResult> {
  const prompt = createPrompt();
  const cwd = resolve(options.cwd || process.cwd());
  const notes: string[] = [];

  try {
    const currentConfig = await loadConfig();
    const mode = await chooseMode(prompt, options);
    const profile = resolveProfileName(mode, options, currentConfig);
    const profileResult = createProfile(profile);
    setActiveProfileName(profile);

    const config = await loadConfig();
    const updatedConfig = { ...config };

    if (mode === 'local') {
      const embeddingChoice = await chooseEmbedding(prompt, options);
      updatedConfig.model = modelForEmbeddingChoice(embeddingChoice);
      updatedConfig.storageMode = 'local';
      updatedConfig.storageUri = '';
      updatedConfig.storageEndpoint = '';
      updatedConfig.cacheBackend = 'local';
      notes.push(`Configured local profile "${profile}" with ${embeddingChoice} embeddings.`);
    } else {
      const envName = options.databaseUrlEnv?.trim() || 'LGREP_DATABASE_URL';
      updatedConfig.storageMode = 'postgres';
      updatedConfig.cacheBackend = 'postgres';
      updatedConfig.storageDatabaseUrlEnv = envName;
      updatedConfig.cacheDatabaseUrlEnv = envName;
      updatedConfig.storageUri = '';
      updatedConfig.storageEndpoint = '';

      if (options.databaseUrl) {
        process.env[envName] = options.databaseUrl;
      }

      if (!process.env[envName]) {
        notes.push(`Set ${envName} before running cloud indexing or search.`);
      }
    }

    await saveConfig(updatedConfig);

    if (mode === 'cloud' && process.env[updatedConfig.storageDatabaseUrlEnv]) {
      const db = await openConfiguredDatabase();
      await db.close();
      notes.push(`Validated Postgres connectivity using ${updatedConfig.storageDatabaseUrlEnv}.`);
    }

    const integration = await chooseIntegration(prompt, options);
    if (integration !== 'none') {
      const includeClaude = integration === 'claude' || integration === 'all';
      const installResult = await runInstallCommand({
        target: integration,
        addToClaudeMd: includeClaude,
        addToProject: includeClaude,
        force: false,
      });
      if (!installResult.success) {
        throw new Error(installResult.error || 'Integration installation failed');
      }
      notes.push(`Installed ${integration} integration.`);
    }

    let indexAction: 'created' | 'updated' | 'skipped' = 'skipped';
    let indexName: string | undefined;
    if (await chooseIndexCurrent(prompt, options)) {
      const indexResult = await maybeIndexCurrentDirectory(cwd, profile, mode, notes);
      indexAction = indexResult.action;
      indexName = indexResult.indexName;
    }

    const verificationCommands = [
      'lgrep doctor',
      'lgrep list',
      indexName
        ? `lgrep search "entry point" --index ${indexName}`
        : 'lgrep search "entry point"',
    ];

    return {
      success: true,
      mode,
      profile,
      profileCreated: profileResult.created,
      configPath: resolve(getProfileHome(profile), 'config.json'),
      integration,
      indexName,
      indexAction,
      notes,
      verificationCommands,
    };
  } catch (error) {
    return {
      success: false,
      mode: options.mode || 'local',
      profile: options.profile || getActiveProfileName(),
      profileCreated: false,
      configPath: resolve(getProfileHome(options.profile || getActiveProfileName()), 'config.json'),
      integration: options.integration || 'none',
      notes,
      verificationCommands: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    prompt.close();
  }
}
