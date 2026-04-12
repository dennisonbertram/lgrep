/**
 * Install lgrep as an MCP server for Claude Code.
 */

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfigSync } from '../../storage/config.js';

export interface InstallMcpOptions {
  force?: boolean;
  json?: boolean;
  serverUrl?: string;
  serverAuthToken?: string;
}

export interface InstallMcpResult {
  success: boolean;
  settingsPath: string;
  configAdded?: boolean;
  configAlreadyExists?: boolean;
  error?: string;
}

function getHostedMcpEnv(options: InstallMcpOptions = {}): Record<string, string> {
  const config = loadConfigSync();
  const env: Record<string, string> = {};
  const hostedEnv = {
    LGREP_SERVER_URL: options.serverUrl?.trim() || process.env['LGREP_SERVER_URL']?.trim() || config.serverUrl.trim(),
    LGREP_SERVER_AUTH_TOKEN:
      options.serverAuthToken?.trim()
      || process.env['LGREP_SERVER_AUTH_TOKEN']?.trim()
      || config.serverAuthToken.trim(),
    LGREP_PROFILE: process.env['LGREP_PROFILE']?.trim(),
  };

  for (const [key, value] of Object.entries(hostedEnv)) {
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Get the lgrep MCP server path.
 */
function getMcpServerPath(): string {
  // Use the built mcp/index.js from the package
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  // From dist/cli/commands/, go up to dist/mcp/index.js
  return join(currentDir, '..', '..', 'mcp', 'index.js');
}

/**
 * Run the install-mcp command.
 */
export async function runInstallMcpCommand(
  options: InstallMcpOptions = {}
): Promise<InstallMcpResult> {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');

    // Ensure .claude directory exists
    const claudeDir = join(homedir(), '.claude');
    if (!existsSync(claudeDir)) {
      await mkdir(claudeDir, { recursive: true });
    }

    // Read existing settings or create new
    let settings: Record<string, unknown> = { mcpServers: {} };
    if (existsSync(settingsPath)) {
      try {
        const content = await readFile(settingsPath, 'utf-8');
        settings = JSON.parse(content) as Record<string, unknown>;
        if (!settings.mcpServers) {
          settings.mcpServers = {};
        }
      } catch {
        // If parse fails, start fresh
        settings = { mcpServers: {} };
      }
    }

    const mcpServers = settings.mcpServers as Record<string, unknown>;

    // Check if lgrep MCP server already configured
    if (mcpServers.lgrep && !options.force) {
      return {
        success: true,
        settingsPath,
        configAlreadyExists: true,
      };
    }

    // Get the MCP server path
    const mcpServerPath = getMcpServerPath();

    // Add lgrep MCP server configuration
    mcpServers.lgrep = {
      command: 'node',
      args: [mcpServerPath],
      env: getHostedMcpEnv(options),
    };

    // Write updated settings
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    return {
      success: true,
      settingsPath,
      configAdded: true,
    };
  } catch (error) {
    return {
      success: false,
      settingsPath: join(homedir(), '.claude', 'settings.json'),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
