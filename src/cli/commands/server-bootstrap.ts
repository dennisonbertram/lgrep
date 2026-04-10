import { basename, resolve } from 'node:path';
import { getProfileHome } from '../utils/profiles.js';
import { runInitCommand } from './init.js';
import { runProjectCreateCommand } from './project.js';
import {
  runWorktreeCreateCommand,
  runWorktreeForkCommand,
  runWorktreeUpdateCommand,
} from './worktree.js';
import { runServerTokenCreateCommand } from './server-token.js';
import { openConfiguredDatabase } from '../../storage/database-config.js';
import { ensureProjectTables, getProject, type Project } from '../../storage/project.js';
import { ensureWorktreeTables, getWorktree, type Worktree } from '../../storage/worktree.js';

export interface HostedWorktreeBootstrapResult {
  name: string;
  path: string;
  branch?: string;
  action: 'created' | 'updated';
}

export interface ServerBootstrapResult {
  success: boolean;
  profile: string;
  configPath: string;
  databaseUrlEnv: string;
  project: {
    name: string;
    id: string;
    created: boolean;
  };
  mainWorktree: HostedWorktreeBootstrapResult;
  additionalWorktrees: HostedWorktreeBootstrapResult[];
  token: {
    id: string;
    label: string;
    value: string;
    path: string;
    projects: string[] | null;
    worktrees: string[] | null;
  };
  server: {
    port: number;
    profile: string;
    serverUrl: string;
    startCommand: string;
    tmuxCommand: string;
    statusCommand: string;
  };
  client: {
    serverUrlEnv: 'LGREP_SERVER_URL';
    tokenEnv: 'LGREP_SERVER_AUTH_TOKEN';
    projectName: string;
    exampleCommands: string[];
  };
  notes: string[];
}

export interface ServerBootstrapOptions {
  path: string;
  profile?: string;
  project?: string;
  mainName?: string;
  branch?: string;
  worktrees?: string[];
  tokenLabel?: string;
  databaseUrlEnv?: string;
  databaseUrl?: string;
  port?: number;
  serverUrl?: string;
  json?: boolean;
}

interface ParsedWorktreeSpec {
  name: string;
  path: string;
  branch?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getCliInvocation(): string {
  const argv1 = process.argv[1];
  if (!argv1) return 'lgrep';

  const resolvedArgv1 = resolve(argv1);
  const normalized = resolvedArgv1.replace(/\\/g, '/');

  if (basename(resolvedArgv1) === 'lgrep') {
    return 'lgrep';
  }

  if (/(?:^|\/)(?:dist|src)\/cli\/.*index\.(?:js|ts)$/.test(normalized)) {
    return `${shellQuote(process.execPath)} ${shellQuote(resolvedArgv1)}`;
  }

  return 'lgrep';
}

function inferProjectName(path: string): string {
  const base = basename(resolve(path)).trim();
  return base || 'repo-main';
}

function parseWorktreeSpec(spec: string): ParsedWorktreeSpec {
  const parts = spec.split('|').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`Invalid --worktree value "${spec}". Use "name|/path/to/worktree" or "name|/path/to/worktree|branch".`);
  }

  const [name, rawPath, branch] = parts;
  if (!name || !rawPath) {
    throw new Error(`Invalid --worktree value "${spec}". Name and path are required.`);
  }

  return {
    name,
    path: resolve(rawPath),
    branch: branch || undefined,
  };
}

async function ensureProject(projectName: string, json?: boolean): Promise<{ project: Project; created: boolean }> {
  const db = await openConfiguredDatabase();
  try {
    await ensureProjectTables(db);
    const existing = await getProject(db, projectName);
    if (existing) {
      return { project: existing, created: false };
    }
  } finally {
    await db.close();
  }

  const created = await runProjectCreateCommand({ name: projectName, json });
  return { project: created, created: true };
}

async function getProjectScopedWorktree(project: Project, nameOrId: string): Promise<Worktree | null> {
  const db = await openConfiguredDatabase();
  try {
    await ensureWorktreeTables(db);
    return await getWorktree(db, nameOrId, { projectId: project.id });
  } finally {
    await db.close();
  }
}

async function ensureMainWorktree(
  project: Project,
  path: string,
  name: string,
  branch: string | undefined,
  json?: boolean,
): Promise<HostedWorktreeBootstrapResult> {
  const absolutePath = resolve(path);
  const existing = await getProjectScopedWorktree(project, name);

  if (existing) {
    if (existing.rootPath && resolve(existing.rootPath) !== absolutePath) {
      throw new Error(`Worktree "${name}" already exists for project "${project.name}" at ${existing.rootPath}.`);
    }
    await runWorktreeUpdateCommand(existing.id, { json });
    return {
      name: existing.name,
      path: absolutePath,
      branch: existing.branch ?? branch,
      action: 'updated',
    };
  }

  await runWorktreeCreateCommand({
    name,
    path: absolutePath,
    branch,
    project: project.name,
    json,
  });

  return {
    name,
    path: absolutePath,
    branch,
    action: 'created',
  };
}

async function ensureForkedWorktree(
  project: Project,
  parentName: string,
  spec: ParsedWorktreeSpec,
  json?: boolean,
): Promise<HostedWorktreeBootstrapResult> {
  const existing = await getProjectScopedWorktree(project, spec.name);

  if (existing) {
    if (existing.rootPath && resolve(existing.rootPath) !== spec.path) {
      throw new Error(`Worktree "${spec.name}" already exists for project "${project.name}" at ${existing.rootPath}.`);
    }
    await runWorktreeUpdateCommand(existing.id, { json });
    return {
      name: existing.name,
      path: spec.path,
      branch: existing.branch ?? spec.branch,
      action: 'updated',
    };
  }

  await runWorktreeForkCommand({
    parent: parentName,
    name: spec.name,
    path: spec.path,
    branch: spec.branch,
    project: project.name,
    json,
  });

  return {
    name: spec.name,
    path: spec.path,
    branch: spec.branch,
    action: 'created',
  };
}

export async function runServerBootstrapCommand(options: ServerBootstrapOptions): Promise<ServerBootstrapResult> {
  const absoluteMainPath = resolve(options.path);
  const profile = options.profile?.trim() || 'cloud';
  const databaseUrlEnv = options.databaseUrlEnv?.trim() || 'LGREP_DATABASE_URL';
  const projectName = options.project?.trim() || inferProjectName(absoluteMainPath);
  const mainName = options.mainName?.trim() || 'main';
  const port = options.port ?? 8420;
  const serverUrl = options.serverUrl?.trim() || `http://127.0.0.1:${port}`;
  const tokenLabel = options.tokenLabel?.trim() || `${projectName} agents`;
  const parsedWorktrees = (options.worktrees ?? []).map(parseWorktreeSpec);
  const duplicateNames = new Set<string>();
  const cliInvocation = getCliInvocation();

  for (const spec of parsedWorktrees) {
    if (spec.name === mainName) {
      throw new Error(`Additional worktree "${spec.name}" conflicts with the main worktree name.`);
    }
    if (duplicateNames.has(spec.name)) {
      throw new Error(`Duplicate additional worktree name "${spec.name}".`);
    }
    duplicateNames.add(spec.name);
  }

  if (options.databaseUrl) {
    process.env[databaseUrlEnv] = options.databaseUrl;
  }
  if (!process.env[databaseUrlEnv]) {
    throw new Error(`Set ${databaseUrlEnv} or pass --database-url before bootstrapping a hosted project.`);
  }

  await runInitCommand({
    mode: 'cloud',
    profile,
    integration: 'none',
    skipIndex: true,
    yes: true,
    databaseUrlEnv,
    databaseUrl: options.databaseUrl,
    json: true,
  });

  const { project, created } = await ensureProject(projectName, options.json);
  const mainWorktree = await ensureMainWorktree(project, absoluteMainPath, mainName, options.branch, options.json);

  const additionalWorktrees: HostedWorktreeBootstrapResult[] = [];
  for (const spec of parsedWorktrees) {
    additionalWorktrees.push(await ensureForkedWorktree(project, mainName, spec, options.json));
  }

  const token = await runServerTokenCreateCommand({
    label: tokenLabel,
    projects: project.name,
  });

  const startCommand = `LGREP_PROFILE=${profile} ${cliInvocation} server start --port ${port}`;
  const tmuxCommand = `tmux new-session -d -s lgrep-server-${project.name} '${startCommand}'`;
  const statusCommand = `LGREP_PROFILE=${profile} ${cliInvocation} server status`;

  return {
    success: true,
    profile,
    configPath: resolve(getProfileHome(profile), 'config.json'),
    databaseUrlEnv,
    project: {
      name: project.name,
      id: project.id,
      created,
    },
    mainWorktree,
    additionalWorktrees,
    token: {
      id: token.id,
      label: token.label,
      value: token.token,
      path: token.path,
      projects: token.projects,
      worktrees: token.worktrees,
    },
    server: {
      port,
      profile,
      serverUrl,
      startCommand,
      tmuxCommand,
      statusCommand,
    },
    client: {
      serverUrlEnv: 'LGREP_SERVER_URL',
      tokenEnv: 'LGREP_SERVER_AUTH_TOKEN',
      projectName: project.name,
      exampleCommands: [
        `lgrep project info ${project.name}`,
        `lgrep worktree list --project ${project.name}`,
        `lgrep search "authentication flow" --project ${project.name}`,
      ],
    },
    notes: [
      `Cloud profile "${profile}" is configured to use ${databaseUrlEnv}.`,
      `Project "${project.name}" is ready for hosted multi-worktree queries.`,
      'Save the token now. It will not be shown again.',
    ],
  };
}
