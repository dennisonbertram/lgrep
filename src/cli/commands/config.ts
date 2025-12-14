import { loadConfig, saveConfig, DEFAULT_CONFIG, type MgrepConfig } from '../../storage/config.js';

// Valid config keys that can be get/set
const VALID_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof MgrepConfig)[];

// Keys that should be parsed as numbers
const NUMERIC_KEYS: (keyof MgrepConfig)[] = ['chunkSize', 'chunkOverlap', 'maxFileSize'];

/**
 * Run the config command.
 *
 * @param key - Optional config key to get or set
 * @param value - Optional value to set (requires key)
 * @returns Output string to display
 */
export async function runConfigCommand(key?: string, value?: string): Promise<string> {
  const config = await loadConfig();

  // Show all config
  if (!key) {
    return formatConfig(config);
  }

  // Validate key
  if (!VALID_KEYS.includes(key as keyof MgrepConfig)) {
    throw new Error(`Unknown config key: ${key}. Valid keys: ${VALID_KEYS.join(', ')}`);
  }

  const typedKey = key as keyof MgrepConfig;

  // Get single value
  if (value === undefined) {
    const val = config[typedKey];
    if (Array.isArray(val)) {
      return val.join(', ');
    }
    return String(val);
  }

  // Set value
  const parsedValue = parseValue(typedKey, value);
  const updatedConfig = { ...config, [typedKey]: parsedValue };
  await saveConfig(updatedConfig);

  return `Set ${key} = ${formatValue(parsedValue)}`;
}

/**
 * Parse a string value to the appropriate type for the config key.
 */
function parseValue(key: keyof MgrepConfig, value: string): MgrepConfig[keyof MgrepConfig] {
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
function formatConfig(config: MgrepConfig): string {
  const lines: string[] = [];

  for (const key of VALID_KEYS) {
    const value = config[key];
    lines.push(`${key}: ${formatValue(value)}`);
  }

  return lines.join('\n');
}
