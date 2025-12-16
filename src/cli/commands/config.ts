import { loadConfig, saveConfig, DEFAULT_CONFIG, type LgrepConfig } from '../../storage/config.js';
import { formatAsJson } from './json-formatter.js';

// Valid config keys that can be get/set
const VALID_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof LgrepConfig)[];

// Keys that should be parsed as numbers
const NUMERIC_KEYS: (keyof LgrepConfig)[] = ['chunkSize', 'chunkOverlap', 'maxFileSize'];

/**
 * Run the config command.
 *
 * @param key - Optional config key to get or set
 * @param value - Optional value to set (requires key)
 * @param json - Output as JSON if true
 * @returns Output string to display
 */
export async function runConfigCommand(key?: string, value?: string, json?: boolean): Promise<string> {
  const config = await loadConfig();

  // Show all config
  if (!key) {
    const textOutput = formatConfig(config);
    if (json) {
      return formatAsJson('config', textOutput);
    }
    return textOutput;
  }

  // Validate key
  if (!VALID_KEYS.includes(key as keyof LgrepConfig)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${VALID_KEYS.join(', ')}`);
  }

  const typedKey = key as keyof LgrepConfig;

  // Get single value
  if (value === undefined) {
    const val = config[typedKey];
    const textOutput = Array.isArray(val) ? val.join(', ') : String(val);
    if (json) {
      // For single value, return it as part of config object
      return formatAsJson('config', `${key}: ${textOutput}`);
    }
    return textOutput;
  }

  // Set value
  const parsedValue = parseValue(typedKey, value);
  const updatedConfig = { ...config, [typedKey]: parsedValue };
  await saveConfig(updatedConfig);

  const textOutput = `Set ${key} = ${formatValue(parsedValue)}`;
  if (json) {
    return formatAsJson('config', `${key}: ${formatValue(parsedValue)}`);
  }
  return textOutput;
}

/**
 * Parse a string value to the appropriate type for the config key.
 */
function parseValue(key: keyof LgrepConfig, value: string): LgrepConfig[keyof LgrepConfig] {
  if (NUMERIC_KEYS.includes(key)) {
    const num = parseInt(value, 10);
    if (isNaN(num)) {
      throw new Error(`Invalid numeric value for ${key}: ${value}`);
    }
    return num;
  }

  // For array fields, split by comma
  if (key === 'excludes' || key === 'secretExcludes') {
    return value.split(',').map(s => s.trim());
  }

  return value;
}

/**
 * Format a config value for display.
 */
function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

/**
 * Format the entire config for display.
 */
function formatConfig(config: LgrepConfig): string {
  const lines: string[] = [];

  for (const key of VALID_KEYS) {
    const value = config[key];
    lines.push(`${key}: ${formatValue(value)}`);
  }

  return lines.join('\n');
}
