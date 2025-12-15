import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Options for install command.
 */
export interface InstallOptions {
  skipSkill?: boolean;
  skipHook?: boolean;
  addToProject?: boolean;
  json?: boolean;
}

/**
 * Result from install command.
 */
export interface InstallResult {
  success: boolean;
  error?: string;
  skillCreated: boolean;
  skillAlreadyExists?: boolean;
  skillPath?: string;
  hookAdded: boolean;
  hookAlreadyExists?: boolean;
  settingsPath?: string;
  projectClaudeUpdated: boolean;
  projectClaudeAlreadyHasMgrep?: boolean;
  projectClaudePath?: string;
}

/**
 * Settings.json structure for hooks.
 */
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

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load template content.
 */
async function loadTemplate(name: string): Promise<string> {
  // In development: src/templates/
  // In production (dist): templates are copied to dist/ root by tsup publicDir
  const devPath = path.join(__dirname, '..', '..', 'templates', name);
  const prodPath = path.join(__dirname, '..', '..', name);

  try {
    return await fs.readFile(devPath, 'utf-8');
  } catch {
    // Try production path
    return await fs.readFile(prodPath, 'utf-8');
  }
}

/**
 * Create the mgrep skill.
 */
async function createSkill(homedir: string): Promise<{ created: boolean; alreadyExists: boolean; path: string }> {
  const skillDir = path.join(homedir, '.claude', 'skills', 'mgrep-search');
  const skillPath = path.join(skillDir, 'SKILL.md');

  // Check if skill already exists
  if (await fileExists(skillPath)) {
    return { created: false, alreadyExists: true, path: skillPath };
  }

  // Create directory
  await fs.mkdir(skillDir, { recursive: true });

  // Load and write skill content
  const skillContent = await loadTemplate('skill.md');
  await fs.writeFile(skillPath, skillContent);

  return { created: true, alreadyExists: false, path: skillPath };
}

/**
 * Add SessionStart hook to settings.json.
 */
async function addSessionStartHook(homedir: string): Promise<{ added: boolean; alreadyExists: boolean; path: string }> {
  const claudeDir = path.join(homedir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const hooksDir = path.join(claudeDir, 'hooks');
  const hookScriptPath = path.join(hooksDir, 'mgrep-check.sh');

  // Ensure .claude directory exists
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(hooksDir, { recursive: true });

  // Load or create settings
  let settings: Settings = {};
  if (await fileExists(settingsPath)) {
    try {
      const content = await fs.readFile(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse settings.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Ensure hooks structure exists
  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!settings.hooks.SessionStart) {
    settings.hooks.SessionStart = [];
  }

  // Check if hook already exists in any SessionStart entry
  const hookExists = settings.hooks.SessionStart.some((entry) =>
    entry.hooks.some((hook) =>
      hook.command === '~/.claude/hooks/mgrep-check.sh' || hook.command.includes('mgrep-check.sh')
    )
  );

  if (hookExists) {
    return { added: false, alreadyExists: true, path: settingsPath };
  }

  // Create hook script
  const hookScript = await loadTemplate('mgrep-check.sh');
  await fs.writeFile(hookScriptPath, hookScript, { mode: 0o755 });

  // Find or create the matcher entry
  let matcherEntry = settings.hooks.SessionStart.find((entry) => entry.matcher === '');

  if (!matcherEntry) {
    matcherEntry = {
      matcher: '',
      hooks: [],
    };
    settings.hooks.SessionStart.push(matcherEntry);
  }

  // Add the hook to the matcher entry
  matcherEntry.hooks.push({
    type: 'command',
    command: '~/.claude/hooks/mgrep-check.sh',
    timeout: 10,
  });

  // Write settings back
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

  return { added: true, alreadyExists: false, path: settingsPath };
}

/**
 * Add mgrep section to project CLAUDE.md.
 */
async function updateProjectClaudeMd(): Promise<{ updated: boolean; alreadyHasMgrep: boolean; path: string }> {
  const cwd = process.cwd();
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');

  // Check if CLAUDE.md exists
  if (!(await fileExists(claudeMdPath))) {
    // Create new CLAUDE.md
    const section = await loadTemplate('claude-md-section.md');
    await fs.writeFile(claudeMdPath, `# Project Configuration\n\n${section}\n`);
    return { updated: true, alreadyHasMgrep: false, path: claudeMdPath };
  }

  // Read existing content
  const content = await fs.readFile(claudeMdPath, 'utf-8');

  // Check if mgrep section already exists
  if (content.includes('## mgrep') || content.includes('# mgrep')) {
    return { updated: false, alreadyHasMgrep: true, path: claudeMdPath };
  }

  // Append mgrep section
  const section = await loadTemplate('claude-md-section.md');
  const newContent = `${content}\n\n${section}\n`;
  await fs.writeFile(claudeMdPath, newContent);

  return { updated: true, alreadyHasMgrep: false, path: claudeMdPath };
}

/**
 * Run the install command.
 */
export async function runInstallCommand(
  options: InstallOptions = {}
): Promise<InstallResult> {
  const { skipSkill = false, skipHook = false, addToProject = false } = options;

  const result: InstallResult = {
    success: false,
    skillCreated: false,
    hookAdded: false,
    projectClaudeUpdated: false,
  };

  try {
    const homedir = os.homedir();

    // Create skill
    if (!skipSkill) {
      const skillResult = await createSkill(homedir);
      result.skillCreated = skillResult.created;
      result.skillAlreadyExists = skillResult.alreadyExists;
      result.skillPath = skillResult.path;
    }

    // Add SessionStart hook
    if (!skipHook) {
      const hookResult = await addSessionStartHook(homedir);
      result.hookAdded = hookResult.added;
      result.hookAlreadyExists = hookResult.alreadyExists;
      result.settingsPath = hookResult.path;
    }

    // Update project CLAUDE.md
    if (addToProject) {
      const claudeMdResult = await updateProjectClaudeMd();
      result.projectClaudeUpdated = claudeMdResult.updated;
      result.projectClaudeAlreadyHasMgrep = claudeMdResult.alreadyHasMgrep;
      result.projectClaudePath = claudeMdResult.path;
    }

    result.success = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}
