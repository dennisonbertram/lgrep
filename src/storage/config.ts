import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfigPath, getLgrepHome } from '../cli/utils/paths.js';
import { DEFAULT_EXCLUDES, DEFAULT_SECRET_EXCLUDES } from '../core/walker.js';

/**
 * Configuration schema for lgrep.
 */
export interface LgrepConfig {
  /** Default embedding model to use */
  model: string;
  /** Target chunk size in tokens */
  chunkSize: number;
  /** Overlap between chunks in tokens */
  chunkOverlap: number;
  /** Maximum file size to index in bytes */
  maxFileSize: number;
  /** Patterns to exclude from indexing */
  excludes: string[];
  /** Patterns for secret files to exclude */
  secretExcludes: string[];
  /**
   * Model to use for code summarization.
   * Format: 'auto' | 'provider:model'
   *
   * - 'auto': Auto-detect best available provider based on API keys
   *   Priority: Groq > Anthropic > OpenAI > Ollama (local fallback)
   *
   * - 'groq:llama-3.1-8b-instant': Use Groq with specific model
   * - 'anthropic:claude-3-5-haiku-latest': Use Anthropic Claude
   * - 'openai:gpt-4o-mini': Use OpenAI GPT
   * - 'ollama:llama3.2:3b': Use local Ollama (default fallback)
   */
  summarizationModel: string;
  /** Whether to enable automatic code summarization */
  enableSummarization: boolean;
  /** Maximum length of generated summaries in characters */
  maxSummaryLength: number;
  /** Maximum tokens in context package */
  contextMaxTokens: number;
  /** Maximum graph traversal depth for context building */
  contextGraphDepth: number;
  /** Maximum number of files to include in context */
  contextFileLimit: number;
  /** Batch size for embedding API calls */
  embedBatchSize: number;
  /** Batch size for LanceDB writes */
  dbBatchSize: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: LgrepConfig = {
  model: 'mxbai-embed-large',
  chunkSize: 500,
  chunkOverlap: 50,
  maxFileSize: 5 * 1024 * 1024, // 5MB
  excludes: [...DEFAULT_EXCLUDES],
  secretExcludes: [...DEFAULT_SECRET_EXCLUDES],
  summarizationModel: 'auto', // Auto-detect best available provider
  enableSummarization: true,
  maxSummaryLength: 100,
  contextMaxTokens: 32000,
  contextGraphDepth: 2,
  contextFileLimit: 15,
  embedBatchSize: 10,
  dbBatchSize: 250,
};

/**
 * Load configuration from file, merging with defaults.
 */
export async function loadConfig(): Promise<LgrepConfig> {
  const configPath = getConfigPath();

  try {
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<LgrepConfig>;

    // Merge with defaults (parsed values override defaults)
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
    };
  } catch (error) {
    // If file doesn't exist or can't be parsed, return defaults
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { ...DEFAULT_CONFIG };
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Save configuration to file.
 */
export async function saveConfig(config: LgrepConfig): Promise<void> {
  const configPath = getConfigPath();

  // Ensure directory exists
  await mkdir(dirname(configPath), { recursive: true });

  // Write config as pretty JSON
  const content = JSON.stringify(config, null, 2);
  await writeFile(configPath, content, 'utf-8');
}

/**
 * Get a specific configuration value.
 */
export async function getConfigValue<K extends keyof LgrepConfig>(
  key: K
): Promise<LgrepConfig[K]> {
  const config = await loadConfig();
  return config[key];
}

/**
 * Set a specific configuration value.
 */
export async function setConfigValue<K extends keyof LgrepConfig>(
  key: K,
  value: LgrepConfig[K]
): Promise<void> {
  const config = await loadConfig();
  config[key] = value;
  await saveConfig(config);
}

/**
 * Type guard for Node.js errors with code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * State file for tracking first-run status.
 */
interface StateFile {
  setupPromptShown?: boolean;
  lastOllamaCheck?: string;
  version?: string;
}

/**
 * Get the path to the state file.
 */
function getStatePath(): string {
  return join(getLgrepHome(), '.state.json');
}

/**
 * Load state file (synchronous for CLI startup).
 */
function loadState(): StateFile {
  try {
    const statePath = getStatePath();
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, 'utf-8'));
    }
  } catch {
    // Ignore errors, return empty state
  }
  return {};
}

/**
 * Save state file (synchronous for CLI startup).
 */
function saveState(state: StateFile): void {
  try {
    const statePath = getStatePath();
    const stateDir = dirname(statePath);
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Ignore errors - state is non-critical
  }
}

/**
 * Check if setup prompt has been shown.
 */
export function hasShownSetupPrompt(): boolean {
  const state = loadState();
  return state.setupPromptShown === true;
}

/**
 * Mark that setup prompt has been shown.
 */
export function markSetupPromptShown(): void {
  const state = loadState();
  state.setupPromptShown = true;
  saveState(state);
}

/**
 * Reset the setup prompt (for testing or after updates).
 */
export function resetSetupPrompt(): void {
  const state = loadState();
  state.setupPromptShown = false;
  saveState(state);
}
