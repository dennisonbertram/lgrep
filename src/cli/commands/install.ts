import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runInstallMcpCommand } from './install-mcp.js';

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
  codexProjectUpdated: boolean;
  codexProjectAlreadyHasLgrep?: boolean;
  codexProjectPath?: string;
  mcpConfigured: boolean;
  mcpAlreadyConfigured?: boolean;
  mcpSettingsPath?: string;
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
  const managedBlock = `${LGREP_SECTION_START}\n${template}\n${LGREP_SECTION_END}`;

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

async function updateUserClaudeMd(homedir: string) {
  return await upsertManagedSection(
    path.join(homedir, '.claude', 'CLAUDE.md'),
    'claude-md-section.md',
    '# User Configuration'
  );
}

async function updateProjectClaudeMd() {
  return await upsertManagedSection(
    path.join(process.cwd(), 'CLAUDE.md'),
    'claude-md-section.md',
    '# Project Configuration'
  );
}

async function updateCodexProjectInstructions() {
  return await upsertManagedSection(
    path.join(process.cwd(), 'AGENTS.md'),
    'agents-md-section.md',
    '# Agent Guidelines'
  );
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
    force = false,
  } = options;

  const result: InstallResult = {
    success: false,
    target,
    targetsApplied,
    skillCreated: false,
    hookAdded: false,
    userClaudeMdUpdated: false,
    projectClaudeUpdated: false,
    codexProjectUpdated: false,
    mcpConfigured: false,
  };

  try {
    const homedir = os.homedir();

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

      if (addToClaudeMd) {
        const userClaudeMdResult = await updateUserClaudeMd(homedir);
        result.userClaudeMdUpdated = userClaudeMdResult.updated;
        result.userClaudeMdAlreadyHasLgrep = userClaudeMdResult.alreadyHasLgrep;
        result.userClaudeMdPath = userClaudeMdResult.path;
      }

      if (addToProject) {
        const claudeMdResult = await updateProjectClaudeMd();
        result.projectClaudeUpdated = claudeMdResult.updated;
        result.projectClaudeAlreadyHasLgrep = claudeMdResult.alreadyHasLgrep;
        result.projectClaudePath = claudeMdResult.path;
      }
    }

    if (targetsApplied.includes('codex')) {
      const codexResult = await updateCodexProjectInstructions();
      result.codexProjectUpdated = codexResult.updated;
      result.codexProjectAlreadyHasLgrep = codexResult.alreadyHasLgrep;
      result.codexProjectPath = codexResult.path;
    }

    if (targetsApplied.includes('mcp')) {
      const mcpResult = await runInstallMcpCommand({ force, json: options.json });
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
