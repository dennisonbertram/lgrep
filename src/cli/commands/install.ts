import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runInstallMcpCommand } from './install-mcp.js';
import { loadConfig, saveConfig } from '../../storage/config.js';
import { getConfigPath } from '../utils/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LGREP_SECTION_START = '<!-- LGREP START -->';
const LGREP_SECTION_END = '<!-- LGREP END -->';

export type InstallTarget = 'claude' | 'codex' | 'mcp' | 'all';

export interface InstallOptions {
  target?: InstallTarget;
  skipSkill?: boolean;
  skipHook?: boolean;
  skipClaudeMd?: boolean;
  addToClaudeMd?: boolean;
  addToProject?: boolean;
  global?: boolean;
  serverUrl?: string;
  serverAuthToken?: string;
  force?: boolean;
  yes?: boolean;
  json?: boolean;
}

export interface InstallResult {
  success: boolean;
  target: InstallTarget;
  targetsApplied: InstallTarget[];
  error?: string;
  skillCreated: boolean;
  skillUpdated?: boolean;
  skillAlreadyExists?: boolean;
  skillPath?: string;
  hookAdded: boolean;
  hookUpdated?: boolean;
  hookAlreadyExists?: boolean;
  settingsPath?: string;
  userClaudeMdUpdated: boolean;
  userClaudeMdAlreadyHasLgrep?: boolean;
  userClaudeMdPath?: string;
  projectClaudeUpdated: boolean;
  projectClaudeAlreadyHasLgrep?: boolean;
  projectClaudePath?: string;
  codexUserUpdated: boolean;
  codexUserAlreadyHasLgrep?: boolean;
  codexUserPath?: string;
  codexProjectUpdated: boolean;
  codexProjectAlreadyHasLgrep?: boolean;
  codexProjectPath?: string;
  mcpConfigured: boolean;
  mcpAlreadyConfigured?: boolean;
  mcpSettingsPath?: string;
  clientConfigUpdated: boolean;
  clientConfigPath?: string;
  configuredServerUrl?: string;
  storedServerAuthToken?: boolean;
}

interface Settings {
  hooks?: {
    SessionStart?: Array<{
      matcher?: string;
      hooks: Array<{
        type: string;
        command: string;
        timeout?: number;
      }>;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function normalizeInstallTarget(target?: string): InstallTarget {
  const normalized = target?.trim().toLowerCase() || 'claude';
  if (normalized === 'claude' || normalized === 'codex' || normalized === 'mcp' || normalized === 'all') {
    return normalized;
  }
  throw new Error(`Unsupported install target "${target}". Use claude, codex, mcp, or all.`);
}

export function expandInstallTargets(target: InstallTarget): InstallTarget[] {
  if (target === 'all') {
    return ['claude', 'codex', 'mcp'];
  }
  return [target];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadTemplate(name: string): Promise<string> {
  const paths = [
    path.join(__dirname, '..', name),
    path.join(__dirname, '..', '..', name),
    path.join(__dirname, '..', '..', 'templates', name),
  ];

  for (const templatePath of paths) {
    try {
      return await fs.readFile(templatePath, 'utf-8');
    } catch {
      // Try next path.
    }
  }

  throw new Error(`Template '${name}' not found. Searched: ${paths.join(', ')}`);
}

async function writeManagedFile(
  filePath: string,
  content: string,
  options?: { mode?: number }
): Promise<{ created: boolean; updated: boolean; alreadyExists: boolean; path: string }> {
  const exists = await fileExists(filePath);
  if (exists) {
    const currentContent = await fs.readFile(filePath, 'utf-8');
    if (currentContent === content) {
      return { created: false, updated: false, alreadyExists: true, path: filePath };
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (options) {
    await fs.writeFile(filePath, content, options);
  } else {
    await fs.writeFile(filePath, content);
  }
  return {
    created: !exists,
    updated: exists,
    alreadyExists: false,
    path: filePath,
  };
}

async function upsertManagedSection(
  filePath: string,
  templateName: string,
  defaultTitle: string
): Promise<{ updated: boolean; alreadyHasLgrep: boolean; path: string }> {
  const template = (await loadTemplate(templateName)).trim();
  return upsertManagedSectionContent(filePath, template, defaultTitle);
}

async function upsertManagedSectionContent(
  filePath: string,
  sectionContent: string,
  defaultTitle: string
): Promise<{ updated: boolean; alreadyHasLgrep: boolean; path: string }> {
  const managedBlock = `${LGREP_SECTION_START}\n${sectionContent.trim()}\n${LGREP_SECTION_END}`;

  if (!(await fileExists(filePath))) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${defaultTitle}\n\n${managedBlock}\n`);
    return { updated: true, alreadyHasLgrep: false, path: filePath };
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const legacyHasSection = content.includes('## lgrep') || content.includes('# lgrep');

  if (content.includes(LGREP_SECTION_START) && content.includes(LGREP_SECTION_END)) {
    const replacement = content.replace(
      new RegExp(`${LGREP_SECTION_START}[\\s\\S]*?${LGREP_SECTION_END}`, 'm'),
      managedBlock
    );
    if (replacement === content) {
      return { updated: false, alreadyHasLgrep: true, path: filePath };
    }
    await fs.writeFile(filePath, replacement);
    return { updated: true, alreadyHasLgrep: false, path: filePath };
  }

  if (legacyHasSection) {
    return { updated: false, alreadyHasLgrep: true, path: filePath };
  }

  const newContent = `${content.trimEnd()}\n\n${managedBlock}\n`;
  await fs.writeFile(filePath, newContent);
  return { updated: true, alreadyHasLgrep: false, path: filePath };
}

function buildRemoteGuidance(serverUrl: string): string {
  return [
    '### Hosted Remote Service',
    '',
    `- This machine is configured to use the hosted lgrep service at \`${serverUrl}\`.`,
    '- Prefer the hosted project/worktree data when it is available.',
    '- Do not ask the user to re-export `LGREP_SERVER_URL` or `LGREP_SERVER_AUTH_TOKEN` if lgrep is already configured globally.',
  ].join('\n');
}

async function renderInstructionSection(templateName: string, serverUrl?: string): Promise<string> {
  const template = (await loadTemplate(templateName)).trim();
  if (!serverUrl) {
    return template;
  }

  return `${template}\n\n${buildRemoteGuidance(serverUrl.trim())}`;
}

async function createSkill(homedir: string) {
  const skillPath = path.join(homedir, '.claude', 'skills', 'lgrep-search', 'SKILL.md');
  if (await fileExists(skillPath)) {
    return {
      created: false,
      updated: false,
      alreadyExists: true,
      path: skillPath,
    };
  }

  await fs.mkdir(path.dirname(skillPath), { recursive: true });
  await fs.writeFile(skillPath, await loadTemplate('skill.md'));

  return {
    created: true,
    updated: false,
    alreadyExists: false,
    path: skillPath,
  };
}

async function addSessionStartHook(homedir: string) {
  const claudeDir = path.join(homedir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const hooksDir = path.join(claudeDir, 'hooks');
  const hookScriptPath = path.join(hooksDir, 'lgrep-check.sh');

  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(hooksDir, { recursive: true });

  let settings: Settings = {};
  if (await fileExists(settingsPath)) {
    try {
      const content = await fs.readFile(settingsPath, 'utf-8');
      settings = JSON.parse(content) as Settings;
    } catch (error) {
      throw new Error(`Failed to parse settings.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!settings.hooks.SessionStart) {
    settings.hooks.SessionStart = [];
  }

  const hookScriptResult = await writeManagedFile(
    hookScriptPath,
    await loadTemplate('lgrep-check.sh'),
    { mode: 0o755 }
  );

  let matcherEntry = settings.hooks.SessionStart.find((entry) => entry.matcher === '');
  if (!matcherEntry) {
    matcherEntry = {
      matcher: '',
      hooks: [],
    };
    settings.hooks.SessionStart.push(matcherEntry);
  }

  const hookExists = matcherEntry.hooks.some(
    (hook) => hook.command === '~/.claude/hooks/lgrep-check.sh' || hook.command.includes('lgrep-check.sh')
  );

  if (!hookExists) {
    matcherEntry.hooks.push({
      type: 'command',
      command: '~/.claude/hooks/lgrep-check.sh',
      timeout: 10,
    });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  }

  return {
    added: !hookExists,
    updated: hookScriptResult.updated,
    alreadyExists: hookExists && !hookScriptResult.updated,
    path: settingsPath,
  };
}

async function updateUserClaudeMd(homedir: string, serverUrl?: string) {
  return await upsertManagedSectionContent(
    path.join(homedir, '.claude', 'CLAUDE.md'),
    await renderInstructionSection('claude-md-section.md', serverUrl),
    '# User Configuration'
  );
}

async function updateProjectClaudeMd(serverUrl?: string) {
  return await upsertManagedSectionContent(
    path.join(process.cwd(), 'CLAUDE.md'),
    await renderInstructionSection('claude-md-section.md', serverUrl),
    '# Project Configuration'
  );
}

async function updateCodexProjectInstructions(serverUrl?: string) {
  return await upsertManagedSectionContent(
    path.join(process.cwd(), 'AGENTS.md'),
    await renderInstructionSection('agents-md-section.md', serverUrl),
    '# Agent Guidelines'
  );
}

async function updateCodexUserInstructions(homedir: string, serverUrl?: string) {
  return await upsertManagedSectionContent(
    path.join(homedir, '.codex', 'AGENTS.md'),
    await renderInstructionSection('agents-md-section.md', serverUrl),
    '# Agent Guidelines'
  );
}

async function persistHostedClientConfig(serverUrl?: string, serverAuthToken?: string) {
  const normalizedUrl = serverUrl?.trim();
  const normalizedToken = serverAuthToken?.trim();

  if (!normalizedUrl && !normalizedToken) {
    return {
      updated: false,
      path: getConfigPath(),
      serverUrl: undefined,
      storedServerAuthToken: false,
    };
  }

  const config = await loadConfig();
  let updated = false;

  if (normalizedUrl && config.serverUrl !== normalizedUrl) {
    config.serverUrl = normalizedUrl;
    updated = true;
  }

  if (normalizedToken && config.serverAuthToken !== normalizedToken) {
    config.serverAuthToken = normalizedToken;
    updated = true;
  }

  if (updated) {
    await saveConfig(config);
  }

  return {
    updated,
    path: getConfigPath(),
    serverUrl: normalizedUrl || (config.serverUrl.trim() || undefined),
    storedServerAuthToken: Boolean(normalizedToken || config.serverAuthToken.trim()),
  };
}

export async function runInstallCommand(
  options: InstallOptions = {}
): Promise<InstallResult> {
  const target = normalizeInstallTarget(options.target);
  const targetsApplied = expandInstallTargets(target);
  const {
    skipSkill = false,
    skipHook = false,
    addToClaudeMd = false,
    addToProject = false,
    global: installGlobal = false,
    force = false,
    serverUrl,
    serverAuthToken,
  } = options;

  const result: InstallResult = {
    success: false,
    target,
    targetsApplied,
    skillCreated: false,
    hookAdded: false,
    userClaudeMdUpdated: false,
    projectClaudeUpdated: false,
    codexUserUpdated: false,
    codexProjectUpdated: false,
    mcpConfigured: false,
    clientConfigUpdated: false,
  };

  try {
    const homedir = os.homedir();
    const clientConfig = await persistHostedClientConfig(serverUrl, serverAuthToken);
    result.clientConfigUpdated = clientConfig.updated;
    result.clientConfigPath = clientConfig.path;
    result.configuredServerUrl = clientConfig.serverUrl;
    result.storedServerAuthToken = clientConfig.storedServerAuthToken;

    if (targetsApplied.includes('claude')) {
      if (!skipSkill) {
        const skillResult = await createSkill(homedir);
        result.skillCreated = skillResult.created;
        result.skillUpdated = skillResult.updated;
        result.skillAlreadyExists = skillResult.alreadyExists;
        result.skillPath = skillResult.path;
      }

      if (!skipHook) {
        const hookResult = await addSessionStartHook(homedir);
        result.hookAdded = hookResult.added;
        result.hookUpdated = hookResult.updated;
        result.hookAlreadyExists = hookResult.alreadyExists;
        result.settingsPath = hookResult.path;
      }

      if (addToClaudeMd || installGlobal) {
        const userClaudeMdResult = await updateUserClaudeMd(homedir, result.configuredServerUrl);
        result.userClaudeMdUpdated = userClaudeMdResult.updated;
        result.userClaudeMdAlreadyHasLgrep = userClaudeMdResult.alreadyHasLgrep;
        result.userClaudeMdPath = userClaudeMdResult.path;
      }

      if (addToProject) {
        const claudeMdResult = await updateProjectClaudeMd(result.configuredServerUrl);
        result.projectClaudeUpdated = claudeMdResult.updated;
        result.projectClaudeAlreadyHasLgrep = claudeMdResult.alreadyHasLgrep;
        result.projectClaudePath = claudeMdResult.path;
      }
    }

    if (targetsApplied.includes('codex')) {
      if (installGlobal) {
        const codexResult = await updateCodexUserInstructions(homedir, result.configuredServerUrl);
        result.codexUserUpdated = codexResult.updated;
        result.codexUserAlreadyHasLgrep = codexResult.alreadyHasLgrep;
        result.codexUserPath = codexResult.path;
      } else {
        const codexResult = await updateCodexProjectInstructions(result.configuredServerUrl);
        result.codexProjectUpdated = codexResult.updated;
        result.codexProjectAlreadyHasLgrep = codexResult.alreadyHasLgrep;
        result.codexProjectPath = codexResult.path;
      }
    }

    if (targetsApplied.includes('mcp')) {
      const mcpResult = await runInstallMcpCommand({
        force,
        json: options.json,
        serverUrl: result.configuredServerUrl,
        serverAuthToken,
      });
      if (!mcpResult.success) {
        throw new Error(mcpResult.error || 'Failed to configure MCP');
      }
      result.mcpConfigured = Boolean(mcpResult.configAdded);
      result.mcpAlreadyConfigured = Boolean(mcpResult.configAlreadyExists);
      result.mcpSettingsPath = mcpResult.settingsPath;
    }

    result.success = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}
