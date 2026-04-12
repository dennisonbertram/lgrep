import { Command } from 'commander';
import { runConfigCommand } from './commands/config.js';
import { runListCommand } from './commands/list.js';
import { runDeleteCommand } from './commands/delete.js';
import { runCleanCommand } from './commands/clean.js';
import { runIndexCommand } from './commands/index.js';
import { runSearchCommand } from './commands/search.js';
import { runAnalyzeCommand } from './commands/analyze.js';
import { runContextCommand } from './commands/context.js';
import { runWatchCommand } from './commands/watch.js';
import { runStopCommand } from './commands/stop.js';
import { runSetupCommand } from './commands/setup.js';
import { runInstallCommand } from './commands/install.js';
import { runInitCommand } from './commands/init.js';
import { runCallersCommand } from './commands/callers.js';
import { runDeadCommand } from './commands/dead.js';
import { runSimilarCommand } from './commands/similar.js';
import { runCyclesCommand } from './commands/cycles.js';
import { runUnusedExportsCommand } from './commands/unused-exports.js';
import { runBreakingCommand } from './commands/breaking.js';
import { runRenameCommand } from './commands/rename.js';
import { runIntentCommand, presentIntentResult } from './commands/intent.js';
import { runDepsCommand } from './commands/deps.js';
import { runImpactCommand } from './commands/impact.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runGraphCommand } from './commands/graph.js';
import { runStatsCommand } from './commands/stats.js';
import { runAuthR2Command, runAuthStatusCommand } from './commands/auth.js';
import { runLogsCommand, followLogs } from './commands/logs.js';
import { runSymbolsCommand } from './commands/symbols.js';
import { runExplainCommand } from './commands/explain.js';
import {
  runDaemonStartCommand,
  runDaemonStopCommand,
  runDaemonListCommand,
  runDaemonQueryCommand,
  runDaemonLogsCommand,
} from './commands/daemon.js';
import {
  runWorktreeCreateCommand,
  runWorktreeForkCommand,
  runWorktreeListCommand,
  runWorktreeDiffCommand,
  runWorktreeDeleteCommand,
  runWorktreeUpdateCommand,
  runWorktreeGcCommand,
} from './commands/worktree.js';
import {
  runProjectCreateCommand,
  runProjectListCommand,
  runProjectInfoCommand,
  runProjectConfigSetCommand,
  runProjectDeleteCommand,
} from './commands/project.js';
import { runServerStartCommand, runServerStatusCommand } from './commands/server.js';
import { runServerTokenCreateCommand, runServerTokenListCommand } from './commands/server-token.js';
import { runServerBootstrapCommand } from './commands/server-bootstrap.js';
import { runServerInstallRemoteCommand } from './commands/server-install-remote.js';
import { runGcCommand } from './commands/gc.js';
import {
  runProfileCreateCommand,
  runProfileListCommand,
  runProfileUseCommand,
} from './commands/profile.js';
import { formatAsJson, formatContextMarkdown } from './commands/json-formatter.js';
import { detectIndexForDirectory } from './utils/auto-detect.js';
import { deleteIndex } from '../storage/lance.js';
import { openConfiguredDatabase } from '../storage/database-config.js';
import { checkFirstRun } from './utils/first-run.js';

const program = new Command();

program
  .name('lgrep')
  .description('Semantic code search CLI with local and Postgres-backed cloud profiles')
  .version('0.1.0');

// Setup command - installs Ollama and pulls required models
program
  .command('setup')
  .description('Install Ollama and pull required models')
  .option('--skip-summarization', 'Skip pulling the summarization model')
  .option('--no-auto-install', 'Do not auto-install Ollama (show instructions only)')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { skipSummarization?: boolean; autoInstall?: boolean; json?: boolean }) => {
    try {
      if (!options.json) {
        console.log('Setting up lgrep...\n');
      }

      const result = await runSetupCommand({
        skipSummarization: options.skipSummarization,
        autoInstall: options.autoInstall,
        json: options.json,
        onProgress: options.json ? undefined : (step: string, status?: string) => {
          const stepLabels: Record<string, string> = {
            'check-install': 'Checking Ollama installation',
            'install': 'Installing Ollama',
            'check-running': 'Checking Ollama status',
            'pull-embed': 'Pulling embedding model',
            'pull-summarization': 'Pulling summarization model',
            'health-check': 'Running health check',
          };

          const label = stepLabels[step] || step;
          if (status) {
            console.log(`  ${label}: ${status}`);
          } else {
            console.log(`  ${label}...`);
          }
        },
      });

      if (options.json) {
        console.log(formatAsJson('setup', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`\nSetup failed: ${result.error}`);
        if (result.instructions) {
          console.error(`\n${result.instructions}`);
        }
        process.exit(1);
      }

      // Success output
      console.log('\nSetup complete!');
      console.log(`  ${result.ollamaInstalled ? '✓' : '✗'} Ollama installed${result.installed ? ' (newly installed)' : ''}`);
      console.log(`  ${result.ollamaRunning ? '✓' : '✗'} Ollama running`);
      console.log(`  ${result.embedModelPulled ? '✓' : '✗'} Embedding model ready`);
      if (!options.skipSummarization) {
        console.log(`  ${result.summarizationModelPulled ? '✓' : '✗'} Summarization model ready`);
      }
      console.log(`  ${result.healthCheckPassed ? '✓' : '✗'} Health check passed`);
      console.log('\nlgrep is ready to use!');
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Guided setup for local or cloud lgrep profiles')
  .option('--mode <mode>', 'Storage mode to configure (local or cloud)')
  .option('--profile <name>', 'Profile name to configure')
  .option('--embedding <provider>', 'Local embedding mode (auto, openai, ollama)')
  .option('--integrate <target>', 'Install integration target (none, claude, codex, mcp, all)')
  .option('--database-url-env <name>', 'Environment variable name for the Postgres connection string', 'LGREP_DATABASE_URL')
  .option('--database-url <url>', 'Postgres connection string for this session only')
  .option('--index-current', 'Index the current directory after setup')
  .option('--skip-index', 'Do not index the current directory')
  .option('-y, --yes', 'Accept defaults for interactive prompts')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: {
    mode?: 'local' | 'cloud';
    profile?: string;
    embedding?: 'auto' | 'openai' | 'ollama';
    integrate?: 'none' | 'claude' | 'codex' | 'mcp' | 'all';
    databaseUrlEnv?: string;
    databaseUrl?: string;
    indexCurrent?: boolean;
    skipIndex?: boolean;
    yes?: boolean;
    json?: boolean;
  }) => {
    try {
      const result = await runInitCommand({
        mode: options.mode,
        profile: options.profile,
        embedding: options.embedding,
        integration: options.integrate,
        databaseUrlEnv: options.databaseUrlEnv,
        databaseUrl: options.databaseUrl,
        indexCurrent: options.indexCurrent,
        skipIndex: options.skipIndex,
        yes: options.yes,
        json: options.json,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`\nSetup failed: ${result.error}`);
        process.exit(1);
      }

      console.log('\nInitialization complete!');
      console.log(`  Profile: ${result.profile}`);
      console.log(`  Mode: ${result.mode}`);
      console.log(`  Config: ${result.configPath}`);
      if (result.integration !== 'none') {
        console.log(`  Integration: ${result.integration}`);
      }
      if (result.indexName && result.indexAction !== 'skipped') {
        console.log(`  Index: ${result.indexName} (${result.indexAction})`);
      }

      if (result.notes.length > 0) {
        console.log('\nNotes:');
        for (const note of result.notes) {
          console.log(`  - ${note}`);
        }
      }

      console.log('\nVerify with:');
      for (const command of result.verificationCommands) {
        console.log(`  ${command}`);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Index command - fully implemented
program
  .command('index <path>')
  .description('Index files in a directory for semantic search')
  .option('-n, --name <name>', 'Name for the index')
  .option('-u, --update', 'Update existing index incrementally (skip unchanged files)')
  .option('-f, --force', 'Delete and recreate index if it exists')
  .option('-r, --retry', 'Retry a failed index')
  .option('--no-summarize', 'Skip symbol summarization')
  .option('--resummarize', 'Force re-summarization of all symbols')
  .option('-j, --json', 'Output as JSON')
  .action(async (path: string, options: { name?: string; update?: boolean; force?: boolean; retry?: boolean; summarize?: boolean; resummarize?: boolean; json?: boolean }) => {
    try {
      // Check for first run and show setup prompt if needed
      if (!options.json) {
        await checkFirstRun();
      }

      // Validate flag conflicts
      if (options.update && options.force) {
        throw new Error('Cannot use both --update and --force flags together');
      }
      if (options.retry && options.force) {
        throw new Error('Cannot use both --retry and --force flags together');
      }
      if (options.retry && options.update) {
        throw new Error('Cannot use both --retry and --update flags together');
      }
      if (options.retry && !options.name) {
        throw new Error('--retry requires --name to specify which failed index to retry');
      }

      // Handle --force flag: delete existing index first
      if (options.force && options.name) {
        const db = await openConfiguredDatabase();
        try {
          await deleteIndex(db, options.name);
        } finally {
          await db.close();
        }
      }

      if (!options.json && !options.update && !options.retry) {
        console.log(`Indexing ${path}...`);
      } else if (!options.json && options.update) {
        console.log(`Updating index for ${path}...`);
      } else if (!options.json && options.retry) {
        console.log(`Retrying failed index "${options.name}"...`);
      }

      const result = await runIndexCommand(path, {
        name: options.name,
        mode: options.update ? 'update' : 'create',
        retry: options.retry,
        json: options.json,
        showProgress: !options.json,
        summarize: options.summarize,
        resummarize: options.resummarize,
      });

      if (options.json) {
        console.log(formatAsJson('index', result));
      } else if (options.update) {
        // Update mode output
        const changes: string[] = [];
        if (result.filesSkipped && result.filesSkipped > 0) {
          changes.push(`${result.filesSkipped} unchanged`);
        }
        if (result.filesUpdated && result.filesUpdated > 0) {
          changes.push(`${result.filesUpdated} updated`);
        }
        if (result.filesAdded && result.filesAdded > 0) {
          changes.push(`${result.filesAdded} added`);
        }
        if (result.filesDeleted && result.filesDeleted > 0) {
          changes.push(`${result.filesDeleted} deleted`);
        }

        console.log(`Updated "${result.indexName}": ${changes.join(', ')} (${result.chunksCreated} new chunks)`);
      } else {
        // Create mode output
        console.log(`Created index "${result.indexName}"`);
        console.log(`  Files processed: ${result.filesProcessed}`);
        console.log(`  Chunks created: ${result.chunksCreated}`);
        if (result.symbolsSummarized) {
          console.log(`  Symbols summarized: ${result.symbolsSummarized}`);
        }
        if (result.summarizationSkipped) {
          console.log(`  ⚠ Summarization skipped (Ollama not available)`);
        }
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Search command - fully implemented with code intelligence
program
  .command('search [query]')
  .description('Search indexed content with code intelligence')
  .option('-i, --index <name>', 'Index to search (auto-detected from current directory if not specified)')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('-d, --diversity <lambda>', 'Diversity parameter (0.0=max diversity, 1.0=pure relevance)', '0.7')
  .option('--usages <symbol>', 'Find usages of a symbol')
  .option('--definition <symbol>', 'Find symbol definition')
  .option('--type <kind>', 'Filter by symbol type (function, class, interface, etc.)')
  .option('-w, --worktree <name>', 'Search within a worktree (uses shared chunk store)')
  .option('-p, --project <name>', 'Search within a project (all worktrees or combined with --worktree)')
  .option('-j, --json', 'Output as JSON')
  .action(async (query: string, options: {
    index?: string;
    limit?: string;
    diversity?: string;
    usages?: string;
    definition?: string;
    type?: string;
    worktree?: string;
    project?: string;
    json?: boolean;
  }) => {
    try {
      // Check for first run and show setup prompt if needed
      if (!options.json) {
        await checkFirstRun();
      }

      const result = await runSearchCommand(query || '', {
        index: options.index,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        diversity: options.diversity ? parseFloat(options.diversity) : undefined,
        usages: options.usages,
        definition: options.definition,
        type: options.type,
        worktree: options.worktree,
        project: options.project,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('search', result));
        return;
      }

      // Handle --usages mode
      if (result.mode === 'usages' && result.usages) {
        if (result.usages.length === 0) {
          console.log(`No usages found for "${result.symbol}".`);
          return;
        }

        console.log(`Found ${result.usages.length} usage(s) of "${result.symbol}":\n`);
        for (const usage of result.usages) {
          const callerInfo = usage.caller ? ` in ${usage.caller} (${usage.callerKind})` : '';
          console.log(`${usage.file}:${usage.line}${callerInfo}`);
        }
        return;
      }

      // Handle --definition mode
      if (result.mode === 'definition' && result.definitions) {
        if (result.definitions.length === 0) {
          console.log(`No definitions found for "${result.symbol}".`);
          return;
        }

        console.log(`Found ${result.definitions.length} definition(s) for "${result.symbol}":\n`);
        for (const def of result.definitions) {
          const exportInfo = def.exported ? ' (exported)' : '';
          const sigInfo = def.signature ? `\n  ${def.signature}` : '';
          console.log(`${def.file}:${def.line} - ${def.kind}${exportInfo}${sigInfo}`);
        }
        return;
      }

      // Handle --type mode
      if (result.mode === 'type' && result.symbols) {
        if (result.symbols.length === 0) {
          console.log(`No symbols found of type "${result.symbolType}".`);
          return;
        }

        console.log(`Found ${result.symbols.length} symbol(s) of type "${result.symbolType}":\n`);
        for (const sym of result.symbols) {
          const exportInfo = sym.exported ? ' (exported)' : '';
          const sigInfo = sym.signature ? `\n  ${sym.signature}` : '';
          console.log(`${sym.name} - ${sym.file}:${sym.line}${exportInfo}${sigInfo}`);
        }
        return;
      }

      // Standard semantic search results
      if (!result.results || result.results.length === 0) {
        console.log('No results found.');
        return;
      }

      console.log(`Found ${result.results.length} result(s):\n`);

      for (const item of result.results) {
        const lineInfo =
          item.lineStart !== undefined && item.lineStart >= 0
            ? `:${item.lineStart}`
            : '';
        console.log(`${item.relativePath}${lineInfo} (score: ${item.score.toFixed(4)})`);
        console.log(`  ${item.content.slice(0, 100).replace(/\n/g, ' ')}${item.content.length > 100 ? '...' : ''}`);
        console.log('');
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// List command - fully implemented
program
  .command('list')
  .description('List all indexes')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const output = await runListCommand(options.json);
      console.log(output);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Graph command - visual graph viewer (dependencies / calls)
program
  .command('graph')
  .description('Open a local web UI to visualize dependency/call graphs')
  .option('-i, --index <name>', 'Index to visualize (auto-detected from current directory if not specified)')
  .option('--mode <mode>', 'Graph mode (deps|calls)', 'deps')
  .option('--external', 'Include external dependencies (deps mode only)', false)
  .option('--port <port>', 'Port to bind (default: 0 for random high port)', '0')
  .option('--no-open', 'Do not auto-open the browser')
  .option('-j, --json', 'Output as JSON (prints URL)')
  .action(async (options: {
    index?: string;
    mode?: string;
    external?: boolean;
    port?: string;
    open?: boolean;
    json?: boolean;
  }) => {
    try {
      const port = options.port ? parseInt(options.port, 10) : 0;
      if (Number.isNaN(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid --port value: "${options.port}"`);
      }
      const mode = options.mode === 'calls' ? 'calls' : 'deps';

      await runGraphCommand({
        index: options.index,
        mode,
        external: options.external,
        port,
        open: options.open,
        json: options.json,
        showProgress: !options.json,
      });
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Delete command - fully implemented
program
  .command('delete <name>')
  .description('Delete an index')
  .option('-f, --force', 'Skip confirmation')
  .option('-j, --json', 'Output as JSON')
  .action(async (name: string, options: { force?: boolean; json?: boolean }) => {
    try {
      const output = await runDeleteCommand(name, options);
      console.log(output);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Clean command - remove zombie, failed, and stale indexes
program
  .command('clean')
  .description('Clean up zombie, failed, and stale indexes')
  .option('-f, --force', 'Skip confirmation')
  .option('--dry-run', 'Show what would be deleted without deleting')
  .option('-j, --json', 'Output as JSON')
  .option('--failed', 'Clean failed indexes')
  .option('--stale', 'Clean indexes with missing paths')
  .option('--zombies', 'Clean zombie indexes (stuck building)')
  .option('--watchers', 'Stop orphaned watchers')
  .option('-a, --all', 'Clean all types (default)')
  .action(async (options: { force?: boolean; dryRun?: boolean; json?: boolean; failed?: boolean; stale?: boolean; zombies?: boolean; watchers?: boolean; all?: boolean }) => {
    try {
      const output = await runCleanCommand(options);
      console.log(output);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Config command - fully implemented
program
  .command('config [key] [value]')
  .description('Get or set configuration values')
  .option('-j, --json', 'Output as JSON')
  .action(async (key: string | undefined, value: string | undefined, options: { json?: boolean }) => {
    try {
      const output = await runConfigCommand(key, value, options.json);
      console.log(output);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

const profileCmd = program
  .command('profile')
  .description('Manage named local or cloud lgrep profiles');

profileCmd
  .command('create <name>')
  .description('Create a new profile')
  .option('-j, --json', 'Output as JSON')
  .action(async (name: string, options: { json?: boolean }) => {
    try {
      const result = await runProfileCreateCommand(name);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`${result.created ? 'Created' : 'Profile already exists'}: ${result.profile}`);
      console.log(`  Path: ${result.path}`);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

profileCmd
  .command('list')
  .description('List available profiles')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const result = await runProfileListCommand();
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log('Profiles:\n');
      for (const profile of result.profiles) {
        const marker = profile.isActive ? '*' : ' ';
        console.log(`${marker} ${profile.name}`);
        console.log(`    Path: ${profile.path}`);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

profileCmd
  .command('use <name>')
  .description('Switch the active profile')
  .option('-j, --json', 'Output as JSON')
  .action(async (name: string, options: { json?: boolean }) => {
    try {
      const result = await runProfileUseCommand(name);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Active profile: ${result.profile}`);
      console.log(`  Path: ${result.path}`);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

const authCmd = program
  .command('auth')
  .description('Manage local remote-storage credentials');

authCmd
  .command('r2')
  .description('Store Cloudflare R2 credentials in the local keychain and switch lgrep to use them')
  .option('--profile <name>', 'Credential profile name', 'default')
  .option('--access-key-id <value>', 'Access key ID to store')
  .option('--secret-access-key <value>', 'Secret access key to store')
  .option('--session-token <value>', 'Optional session token to store')
  .option('--access-key-id-env <name>', 'Environment variable name to read the access key from', 'AWS_ACCESS_KEY_ID')
  .option('--secret-access-key-env <name>', 'Environment variable name to read the secret key from', 'AWS_SECRET_ACCESS_KEY')
  .option('--session-token-env <name>', 'Environment variable name to read the session token from', 'AWS_SESSION_TOKEN')
  .option('--storage-uri <uri>', 'Default storage URI to save into lgrep config')
  .option('--endpoint <url>', 'Default R2 endpoint to save into lgrep config')
  .option('--region <name>', 'Remote storage region to save into lgrep config', 'auto')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: {
    profile?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    accessKeyIdEnv?: string;
    secretAccessKeyEnv?: string;
    sessionTokenEnv?: string;
    storageUri?: string;
    endpoint?: string;
    region?: string;
    json?: boolean;
  }) => {
    try {
      const result = await runAuthR2Command(options);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Stored R2 credentials in keychain profile "${result.profile}"`);
      if (result.storageUri) {
        console.log(`Configured remote storage: ${result.storageUri}`);
      }
      if (result.endpoint) {
        console.log(`Configured endpoint: ${result.endpoint}`);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

authCmd
  .command('status')
  .description('Show remote credential status for the local lgrep install')
  .option('--profile <name>', 'Credential profile name override')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { profile?: string; json?: boolean }) => {
    try {
      const result = await runAuthStatusCommand(options.profile);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log('lgrep auth status');
      console.log(`  Storage mode: ${result.storageMode}`);
      console.log(`  Storage URI: ${result.storageUri || '(not configured)'}`);
      console.log(`  Endpoint: ${result.endpoint || '(not configured)'}`);
      console.log(`  Credential source: ${result.credentialSource}`);
      console.log(`  Profile: ${result.profile}`);
      console.log(`  Keychain supported: ${result.keychainSupported ? 'yes' : 'no'}`);
      console.log(`  Credentials stored: ${result.credentialsStored ? 'yes' : 'no'}`);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Analyze command - Phase 4
program
  .command('analyze <path>')
  .description('Analyze code structure (symbols, dependencies, calls)')
  .option('-i, --index <name>', 'Store results in named index')
  .option('--symbols', 'List all symbols')
  .option('--deps', 'Show dependency graph')
  .option('--calls', 'Show call graph')
  .option('--tree', 'Output full AST tree')
  .option('--file <path>', 'Analyze single file only')
  .option('-j, --json', 'Output as JSON')
  .action(async (
    path: string,
    options: {
      index?: string;
      symbols?: boolean;
      deps?: boolean;
      calls?: boolean;
      tree?: boolean;
      file?: string;
      json?: boolean;
    }
  ) => {
    try {
      const result = await runAnalyzeCommand(path, options);

      if (options.json) {
        console.log(formatAsJson('analyze', result, { path }));
        return;
      }

      // Human-readable output
      console.log(`Analyzed ${result.filesAnalyzed} file(s)\n`);

      // Show stats
      console.log('Statistics:');
      console.log(`  Symbols: ${result.stats.totalSymbols}`);
      console.log(`  Dependencies: ${result.stats.totalDependencies}`);
      console.log(`  Calls: ${result.stats.totalCalls}`);

      if (Object.keys(result.stats.byKind).length > 0) {
        console.log('\nBy kind:');
        for (const [kind, count] of Object.entries(result.stats.byKind)) {
          console.log(`  ${kind}: ${count}`);
        }
      }

      // Show symbols if requested
      if (options.symbols && result.symbols) {
        console.log('\nSymbols:');
        for (const symbol of result.symbols) {
          const exported = symbol.isExported ? ' (exported)' : '';
          console.log(`  ${symbol.kind} ${symbol.name}${exported} - ${symbol.relativePath}:${symbol.lineStart}`);
        }
      }

      // Show dependencies if requested
      if (options.deps && result.dependencies) {
        console.log('\nDependencies:');
        for (const dep of result.dependencies) {
          const external = dep.isExternal ? ' (external)' : '';
          console.log(`  ${dep.kind}: ${dep.targetModule}${external} - ${dep.sourceFile}:${dep.line}`);
        }
      }

      // Show calls if requested
      if (options.calls && result.calls) {
        console.log('\nCalls:');
        for (const call of result.calls) {
          const method = call.isMethodCall ? 'method' : 'function';
          console.log(`  ${call.callerId} -> ${call.calleeName} (${method}) - ${call.callerFile}:${call.line}`);
        }
      }

      // Show errors if any
      if (result.errors.length > 0) {
        console.log('\nErrors:');
        for (const error of result.errors) {
          console.error(`  ${error}`);
        }
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Context command - Phase 4: Context Builder
program
  .command('context <task>')
  .description('Build context for a task (for LLM consumption)')
  .option('-i, --index <name>', 'Index to search (auto-detected from current directory if not specified)')
  .option('-p, --project <name>', 'Hosted project to query')
  .option('--worktree <name>', 'Hosted worktree to query (use with --project or by name)')
  .option('-l, --limit <n>', 'Max files to include', '15')
  .option('--max-tokens <n>', 'Token budget', '32000')
  .option('--depth <n>', 'Graph traversal depth', '2')
  .option('--summary-only', 'Exclude code snippets')
  .option('--no-approach', 'Skip approach suggestions')
  .option('--format <type>', 'Output format (json|markdown)', 'json')
  .option('-j, --json', 'JSON output (same as --format json)')
  .action(async (task: string, options: {
    index?: string;
    project?: string;
    worktree?: string;
    limit?: string;
    maxTokens?: string;
    depth?: string;
    summaryOnly?: boolean;
    approach?: boolean;
    format?: string;
    json?: boolean;
  }) => {
    try {
      const result = await runContextCommand(task, {
        index: options.index,
        project: options.project,
        worktree: options.worktree,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        maxTokens: options.maxTokens ? parseInt(options.maxTokens, 10) : undefined,
        depth: options.depth ? parseInt(options.depth, 10) : undefined,
        summaryOnly: options.summaryOnly,
        noApproach: !options.approach,
        format: options.json ? 'json' : (options.format as 'json' | 'markdown'),
        json: options.json,
      });

      if (options.format === 'markdown' && !options.json) {
        console.log(formatContextMarkdown(result));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Watch command - starts the daemon to watch for file changes
program
  .command('watch <path>')
  .description('Start watching a directory for changes')
  .option('-n, --name <name>', 'Name for the index')
  .option('-r, --restart', 'Restart if already running')
  .option('-j, --json', 'Output as JSON')
  .action(async (path: string, options: { name?: string; json?: boolean; restart?: boolean }) => {
    try {
      const result = await runWatchCommand(path, {
        name: options.name,
        json: options.json,
        restart: options.restart,
      });

      if (options.json) {
        console.log(formatAsJson('watch', result));
      } else {
        console.log(`Watching ${path} as '${result.indexName}' (PID: ${result.pid})`);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Stop command - stops a running watch daemon
program
  .command('stop <name>')
  .description('Stop watching an index')
  .option('-j, --json', 'Output as JSON')
  .action(async (name: string, options: { json?: boolean }) => {
    try {
      const result = await runStopCommand(name, {
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('stop', result));
      } else {
        console.log(`Stopped watcher for '${result.indexName}'`);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Callers command - shows all locations that call a given function
program
  .command('callers <symbol>')
  .description('Show all locations that call a given function/method')
  .option('-i, --index <name>', 'Index to search (auto-detected from current directory if not specified)')
  .option('-p, --project <name>', 'Hosted project to query')
  .option('--worktree <name>', 'Hosted worktree to query (use with --project or by name)')
  .option('-j, --json', 'Output as JSON')
  .action(async (symbol: string, options: { index?: string; project?: string; worktree?: string; json?: boolean }) => {
    try {
      const result = await runCallersCommand(symbol, {
        index: options.index,
        project: options.project,
        worktree: options.worktree,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('callers', result));
        return;
      }

      if (result.callers!.length === 0) {
        console.log(`No callers found for "${symbol}".`);
        return;
      }

      console.log(`Callers of "${symbol}":\n`);
      for (const caller of result.callers!) {
        const callerInfo = caller.callerName ? ` in ${caller.callerName}()` : '';
        console.log(`  ${caller.file}:${caller.line}${callerInfo}`);
      }
      console.log(`\n${result.count} caller${result.count === 1 ? '' : 's'} found`);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Deps command - shows what modules import/depend on a given module
program
  .command('deps <module>')
  .description('Show what modules import/depend on a given module')
  .option('-i, --index <name>', 'Index to search (auto-detected from current directory if not specified)')
  .option('-j, --json', 'Output as JSON')
  .action(async (module: string, options: { index?: string; json?: boolean }) => {
    try {
      const result = await runDepsCommand(module, {
        index: options.index,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('deps', result));
        return;
      }

      if (result.dependents!.length === 0) {
        console.log(`No dependents found for "${module}".`);
        return;
      }

      console.log(`Dependents of "${module}":\n`);
      for (const dep of result.dependents!) {
        const imports = dep.imports.length > 0 ? ` (imports: ${dep.imports.join(', ')})` : '';
        console.log(`  ${dep.file}${imports}`);
      }
      console.log(`\n${result.count} dependent${result.count === 1 ? '' : 's'} found`);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Impact command - combines callers with transitive analysis
program
  .command('impact <symbol>')
  .description('Show the blast radius if you change a function (direct callers + transitive impact)')
  .option('-i, --index <name>', 'Index to search (auto-detected from current directory if not specified)')
  .option('-p, --project <name>', 'Hosted project to query')
  .option('--worktree <name>', 'Hosted worktree to query (use with --project or by name)')
  .option('-j, --json', 'Output as JSON')
  .action(async (symbol: string, options: { index?: string; project?: string; worktree?: string; json?: boolean }) => {
    try {
      const result = await runImpactCommand(symbol, {
        index: options.index,
        project: options.project,
        worktree: options.worktree,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('impact', result));
        return;
      }

      console.log(`Impact analysis for "${symbol}":\n`);

      if (result.directCallers!.length === 0) {
        console.log('No direct callers found.');
        console.log('\nTotal: 0 files potentially affected');
        return;
      }

      console.log(`Direct callers (${result.directCallers!.length}):`);
      for (const caller of result.directCallers!) {
        const callerInfo = caller.callerName ? ` → ${caller.callerName}()` : '';
        console.log(`  ${caller.file}:${caller.line}${callerInfo}`);
      }

      if (result.transitiveFiles!.length > 0) {
        console.log(`\nTransitive impact (${result.transitiveFiles!.length} more file${result.transitiveFiles!.length === 1 ? '' : 's'}):`);
        for (const file of result.transitiveFiles!.slice(0, 10)) {
          console.log(`  ${file}`);
        }
        if (result.transitiveFiles!.length > 10) {
          console.log(`  ... and ${result.transitiveFiles!.length - 10} more`);
        }
      }

      console.log(`\nTotal: ${result.totalFiles} file${result.totalFiles === 1 ? '' : 's'} potentially affected`);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Dead command - find symbols without callers
program
  .command('dead')
  .description('List functions/methods with zero callers')
  .option('-i, --index <name>', 'Index to inspect (auto-detected otherwise)')
  .option('-l, --limit <number>', 'Maximum symbols to show')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { index?: string; limit?: string; json?: boolean }) => {
    try {
      const result = await runDeadCommand({
        index: options.index,
        json: options.json,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });

      if (options.json) {
        console.log(formatAsJson('dead', result));
        return;
      }

      if (result.deadSymbols.length === 0) {
        console.log('No dead symbols found.');
        return;
      }

      console.log('Dead symbols (no callers):');
      for (const sym of result.deadSymbols) {
        console.log(`  ${sym.relativePath} - ${sym.name} (${sym.kind})`);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Similar command - duplicate/snippet detection
program
  .command('similar')
  .description('Find groups of symbols with similar code')
  .option('-i, --index <name>', 'Index to inspect (auto-detected otherwise)')
  .option('-l, --limit <number>', 'Maximum groups to show')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { index?: string; limit?: string; json?: boolean }) => {
    try {
      const result = await runSimilarCommand({
        index: options.index,
        json: options.json,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });

      if (options.json) {
        console.log(formatAsJson('similar', result));
        return;
      }

      if (result.groups.length === 0) {
        console.log('No similar symbol groups detected.');
        return;
      }

      console.log('Similar code groups:');
      for (const group of result.groups) {
        console.log(`\nGroup (${group.symbols.length} matches):`);
        for (const sym of group.symbols) {
          console.log(`  ${sym.relativePath} - ${sym.name} (${sym.kind})`);
        }
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Cycles command - detect dependency cycles
program
  .command('cycles')
  .description('Detect circular import/dependency chains')
  .option('-i, --index <name>', 'Index to inspect (auto-detected otherwise)')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { index?: string; json?: boolean }) => {
    try {
      const result = await runCyclesCommand({
        index: options.index,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('cycles', result));
        return;
      }

      if (result.cycles.length === 0) {
        console.log('No cycles detected in dependencies.');
        return;
      }

      console.log('Detected dependency cycles:');
      for (const cycle of result.cycles) {
        console.log('  ' + cycle.join(' -> '));
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Unused exports command
program
  .command('unused-exports')
  .description('List exports that are never imported')
  .option('-i, --index <name>', 'Index to inspect (auto-detected otherwise)')
  .option('-l, --limit <number>', 'Maximum symbols to show')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { index?: string; limit?: string; json?: boolean }) => {
    try {
      const result = await runUnusedExportsCommand({
        index: options.index,
        json: options.json,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });

      if (options.json) {
        console.log(formatAsJson('unused-exports', result));
        return;
      }

      if (result.unused.length === 0) {
        console.log('No unused exports found.');
        return;
      }

      console.log('Unused exports:');
      for (const exp of result.unused) {
        console.log(`  ${exp.relativePath} - ${exp.name} (${exp.kind})`);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Breaking command - detect signature mismatches
program
  .command('breaking')
  .description('Check for calls that may break when signature changes')
  .option('-i, --index <name>', 'Index to inspect (auto-detected otherwise)')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { index?: string; json?: boolean }) => {
    try {
      const result = await runBreakingCommand({
        index: options.index,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('breaking', result));
        return;
      }

      if (result.mismatches.length === 0) {
        console.log('No signature mismatches detected.');
        return;
      }

      console.log('Potential breaking signature mismatches:');
      for (const mismatch of result.mismatches) {
        console.log(`\n${mismatch.relativePath} - ${mismatch.name} (${mismatch.signature})`);
        for (const call of mismatch.calls) {
          console.log(`  ${call.file}:${call.line} - args: ${call.argumentCount} vs expected ${call.expected}`);
        }
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Rename command - preview references
program
  .command('rename <oldName> <newName>')
  .description('Preview the impact of renaming a symbol')
  .option('-i, --index <name>', 'Index to inspect (auto-detected otherwise)')
  .option('-l, --limit <number>', 'Max preview references to show')
  .option('-j, --json', 'Output as JSON')
  .action(async (oldName: string, newName: string, options: { index?: string; limit?: string; json?: boolean }) => {
    try {
      const result = await runRenameCommand(oldName, newName, {
        index: options.index,
        json: options.json,
        preview: true,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });

      if (options.json) {
        console.log(formatAsJson('rename', result));
        return;
      }

      console.log(`Rename "${result.symbolName}" → "${result.newName}" (${result.totalReferences} reference${result.totalReferences === 1 ? '' : 's'})`);
      if (result.references.length === 0) {
        return;
      }

      for (const ref of result.references) {
        console.log(`  ${ref.file}:${ref.line}${ref.callerName ? ` in ${ref.callerName}` : ''}`);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Intent command - natural-language router
program
  .command('intent <prompt>')
  .description('Interpret NL intent and run the appropriate lgrep command')
  .option('-i, --index <name>', 'Index to inspect (auto-detected otherwise)')
  .option('-l, --limit <number>', 'Limit for commands that support it')
  .option('-j, --json', 'Output as JSON')
  .action(async (prompt: string, options: { index?: string; limit?: string; json?: boolean }) => {
    try {
      const result = await runIntentCommand(prompt, {
        index: options.index,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        json: options.json,
      });

      presentIntentResult(result, options.json);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Install command - integrates lgrep with Claude Code
program
  .command('install')
  .description('Install lgrep integration for Claude, Codex, or MCP')
  .option('-t, --target <target>', 'Integration target (claude, codex, mcp, all)', 'claude')
  .option('--global', 'Install user-global Claude/Codex guidance instead of only repo-local guidance')
  .option('--skip-skill', 'Do not create the skill')
  .option('--skip-hook', 'Do not add SessionStart hook')
  .option('--add-to-claude-md', 'Also add lgrep section to ~/.claude/CLAUDE.md')
  .option('--add-to-project', 'Also add lgrep section to project CLAUDE.md')
  .option('--server-url <url>', 'Persist a hosted query server URL in the active lgrep profile')
  .option('--server-auth-token <token>', 'Persist a hosted bearer token in the active lgrep profile')
  .option('-f, --force', 'Overwrite existing MCP configuration when target includes mcp')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: {
    target?: 'claude' | 'codex' | 'mcp' | 'all';
    global?: boolean;
    skipSkill?: boolean;
    skipHook?: boolean;
    addToClaudeMd?: boolean;
    addToProject?: boolean;
    serverUrl?: string;
    serverAuthToken?: string;
    force?: boolean;
    yes?: boolean;
    json?: boolean;
  }) => {
    try {
      const result = await runInstallCommand({
        target: options.target,
        global: options.global,
        skipSkill: options.skipSkill,
        skipHook: options.skipHook,
        addToClaudeMd: options.addToClaudeMd,
        addToProject: options.addToProject,
        serverUrl: options.serverUrl,
        serverAuthToken: options.serverAuthToken,
        force: options.force,
        yes: options.yes,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('install', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`\nInstallation failed: ${result.error}`);
        process.exit(1);
      }

      // Success output
      console.log('\nInstallation complete!');
      console.log(`  Target: ${result.target}`);
      if (result.configuredServerUrl) {
        console.log(`  Hosted server: ${result.configuredServerUrl}`);
      }
      if (result.clientConfigUpdated) {
        console.log(`  ✓ Client config updated at ${result.clientConfigPath}`);
      }

      if ((result.targetsApplied.includes('claude')) && !options.skipSkill) {
        if (result.skillCreated) {
          console.log(`  ✓ Skill created at ${result.skillPath}`);
        } else if (result.skillUpdated) {
          console.log(`  ✓ Skill updated at ${result.skillPath}`);
        } else if (result.skillAlreadyExists) {
          console.log(`  ○ Skill already exists at ${result.skillPath}`);
        }
      }

      if (result.targetsApplied.includes('claude') && !options.skipHook) {
        if (result.hookAdded) {
          console.log(`  ✓ SessionStart hook added to ${result.settingsPath}`);
        } else if (result.hookUpdated) {
          console.log(`  ✓ SessionStart hook updated in ${result.settingsPath}`);
        } else if (result.hookAlreadyExists) {
          console.log(`  ○ SessionStart hook already exists in ${result.settingsPath}`);
        }
      }

      if (options.addToClaudeMd) {
        if (result.userClaudeMdUpdated) {
          console.log(`  ✓ CLAUDE.md updated at ${result.userClaudeMdPath}`);
        } else if (result.userClaudeMdAlreadyHasLgrep) {
          console.log(`  ○ CLAUDE.md already has lgrep section at ${result.userClaudeMdPath}`);
        }
      }

      if (options.addToProject) {
        if (result.projectClaudeUpdated) {
          console.log(`  ✓ Project CLAUDE.md updated at ${result.projectClaudePath}`);
        } else if (result.projectClaudeAlreadyHasLgrep) {
          console.log(`  ○ Project CLAUDE.md already has lgrep section at ${result.projectClaudePath}`);
        }
      }

      if (result.targetsApplied.includes('codex')) {
        if (result.codexUserUpdated) {
          console.log(`  ✓ Global AGENTS.md updated at ${result.codexUserPath}`);
        } else if (result.codexUserAlreadyHasLgrep) {
          console.log(`  ○ Global AGENTS.md already has lgrep guidance at ${result.codexUserPath}`);
        } else if (result.codexProjectUpdated) {
          console.log(`  ✓ AGENTS.md updated at ${result.codexProjectPath}`);
        } else if (result.codexProjectAlreadyHasLgrep) {
          console.log(`  ○ AGENTS.md already has lgrep guidance at ${result.codexProjectPath}`);
        }
      }

      if (result.targetsApplied.includes('mcp')) {
        if (result.mcpConfigured) {
          console.log(`  ✓ MCP configured in ${result.mcpSettingsPath}`);
        } else if (result.mcpAlreadyConfigured) {
          console.log(`  ○ MCP already configured in ${result.mcpSettingsPath}`);
        }
      }

      console.log('\nlgrep integration is ready.');
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Install MCP command - configure lgrep as MCP server
program
  .command('install-mcp')
  .description('Install lgrep as an MCP server for Claude Code')
  .option('-f, --force', 'Overwrite existing MCP configuration')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { force?: boolean; json?: boolean }) => {
    try {
      const { runInstallMcpCommand } = await import('./commands/install-mcp.js');
      const result = await runInstallMcpCommand({
        force: options.force,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('install-mcp', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`\nMCP installation failed: ${result.error}`);
        process.exit(1);
      }

      if (result.configAdded) {
        console.log('\nMCP server configured successfully!');
        console.log(`  Config file: ${result.settingsPath}`);
        console.log('\nRestart Claude Code to use lgrep MCP tools.');
      } else if (result.configAlreadyExists) {
        console.log('\nMCP server already configured.');
        console.log(`  Config file: ${result.settingsPath}`);
        console.log('  Use --force to overwrite existing configuration.');
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Doctor command - check lgrep health and configuration
program
  .command('doctor')
  .description('Check lgrep health, configuration, and indexing status')
  .option('-p, --path <path>', 'Path to check (defaults to current directory)')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { path?: string; json?: boolean }) => {
    try {
      const result = await runDoctorCommand({
        path: options.path,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('doctor', result));
        process.exit(result.success ? 0 : 1);
      }

      // Header
      console.log('\n🩺 lgrep doctor\n');

      // Status icons
      const icons = {
        ok: '✓',
        warn: '⚠',
        error: '✗',
      };

      const colors = {
        ok: '\x1b[32m',    // green
        warn: '\x1b[33m',  // yellow
        error: '\x1b[31m', // red
        reset: '\x1b[0m',
      };

      // Print each check
      for (const check of result.checks) {
        const icon = icons[check.status];
        const color = colors[check.status];
        console.log(`${color}${icon}${colors.reset} ${check.name}: ${check.message}`);
        if (check.fix && check.status !== 'ok') {
          console.log(`    → ${check.fix}`);
        }
      }

      // Summary
      console.log('\n' + '─'.repeat(50));
      const { ok, warn, error } = result.summary;
      console.log(
        `${colors.ok}${ok} passed${colors.reset}, ` +
        `${colors.warn}${warn} warnings${colors.reset}, ` +
        `${colors.error}${error} errors${colors.reset}`
      );

      if (result.success) {
        console.log('\n✨ lgrep is healthy and ready to use!');
      } else {
        console.log('\n⚠️  Some issues need attention. See fixes above.');
        process.exit(1);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Stats command - show index statistics
program
  .command('stats')
  .description('Show index statistics (files, chunks, symbols, etc.)')
  .option('-i, --index <name>', 'Index to show stats for (auto-detected if not specified)')
  .option('-a, --all', 'Show stats for all indexes')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { index?: string; all?: boolean; json?: boolean }) => {
    try {
      const result = await runStatsCommand({
        index: options.index,
        all: options.all,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('stats', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      // Format size
      const formatSize = (bytes?: number) => {
        if (!bytes) return 'unknown';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      };

      if (result.all && result.totals) {
        console.log('\n📊 lgrep stats (all indexes)\n');
        console.log(`Database: ${result.dbPath} (${formatSize(result.dbSizeBytes)})\n`);

        for (const idx of result.all!) {
          const watcherStatus = idx.watcherRunning ? `✓ watching (PID ${idx.watcherPid})` : '○ not watching';
          console.log(`  ${idx.name}`);
          console.log(`    Path: ${idx.rootPath}`);
          console.log(`    Files: ${idx.files} | Chunks: ${idx.chunks} | Symbols: ${idx.symbols}`);
          console.log(`    Calls: ${idx.calls} | Dependencies: ${idx.dependencies}`);
          console.log(`    Watcher: ${watcherStatus}`);
          console.log();
        }

        console.log('─'.repeat(50));
        console.log(`Totals: ${result.totals.indexes} indexes, ${result.totals.chunks} chunks, ${result.totals.symbols} symbols`);
      } else if (result.index) {
        const idx = result.index;
        const watcherStatus = idx.watcherRunning ? `✓ watching (PID ${idx.watcherPid})` : '○ not watching';

        console.log('\n📊 lgrep stats\n');
        console.log(`Index: ${idx.name}`);
        console.log(`Path: ${idx.rootPath}`);
        console.log(`Status: ${idx.status}`);
        console.log(`Model: ${idx.model || 'default'}`);
        console.log(`Created: ${idx.createdAt || 'unknown'}`);
        console.log(`Updated: ${idx.updatedAt || 'unknown'}`);
        console.log();
        console.log(`Files:        ${idx.files}`);
        console.log(`Chunks:       ${idx.chunks}`);
        console.log(`Symbols:      ${idx.symbols}`);
        console.log(`Calls:        ${idx.calls}`);
        console.log(`Dependencies: ${idx.dependencies}`);
        console.log();
        console.log(`Watcher: ${watcherStatus}`);
        console.log(`Database: ${formatSize(result.dbSizeBytes)}`);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Logs command - view watcher daemon logs
program
  .command('logs')
  .description('View watcher daemon logs')
  .option('-i, --index <name>', 'Index to show logs for (auto-detected if not specified)')
  .option('-n, --lines <n>', 'Number of lines to show (default: 50)', '50')
  .option('-f, --follow', 'Follow logs in real-time (like tail -f)')
  .option('-a, --all', 'Show logs for all watchers')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { index?: string; lines?: string; follow?: boolean; all?: boolean; json?: boolean }) => {
    try {
      const lines = parseInt(options.lines || '50', 10);

      // Follow mode
      if (options.follow) {
        let indexName: string = options.index ?? '';
        if (!indexName) {
          const detected = await detectIndexForDirectory(process.cwd());
          indexName = detected ?? (await import('node:path')).basename(process.cwd());
        }
        await followLogs(indexName);
        return;
      }

      const result = await runLogsCommand({
        index: options.index,
        lines,
        all: options.all,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('logs', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      if (result.logs) {
        for (const log of result.logs) {
          console.log(`\n=== ${log.indexName} (${log.logPath}) ===\n`);
          if (log.content) {
            console.log(log.content);
          }
        }
      } else if (result.log) {
        console.log(`\n=== ${result.log.indexName} ===\n`);
        if (result.log.content) {
          console.log(result.log.content);
        }
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Symbols command - quick symbol lookup
program
  .command('symbols [query]')
  .description('Quick symbol lookup by name')
  .option('-i, --index <name>', 'Index to search (auto-detected if not specified)')
  .option('-k, --kind <kind>', 'Filter by kind (function, class, method, etc.)')
  .option('-f, --file <pattern>', 'Filter by file path pattern')
  .option('-l, --limit <n>', 'Maximum results (default: 50)', '50')
  .option('-j, --json', 'Output as JSON')
  .action(async (query: string | undefined, options: { index?: string; kind?: string; file?: string; limit?: string; json?: boolean }) => {
    try {
      const limit = parseInt(options.limit || '50', 10);

      const result = await runSymbolsCommand(query, {
        index: options.index,
        kind: options.kind,
        file: options.file,
        limit,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('symbols', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      if (!result.matches || result.matches.length === 0) {
        console.log('No symbols found.');
        return;
      }

      console.log(`\nFound ${result.total} symbol(s)${result.total! > result.matches.length ? ` (showing ${result.matches.length})` : ''}:\n`);

      for (const sym of result.matches) {
        const sig = sym.signature ? ` ${sym.signature}` : '';
        console.log(`  ${sym.kind.padEnd(10)} ${sym.name}${sig}`);
        console.log(`             ${sym.file}:${sym.line}`);
        if (sym.summary) {
          console.log(`             ${sym.summary.slice(0, 80)}${sym.summary.length > 80 ? '...' : ''}`);
        }
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Explain command - AI-powered code explanation
program
  .command('explain <target>')
  .description('AI-powered explanation of a file or symbol')
  .option('-i, --index <name>', 'Index to use for context (auto-detected if not specified)')
  .option('-m, --model <model>', 'AI model to use (auto-detected if not specified)')
  .option('-j, --json', 'Output as JSON')
  .action(async (target: string, options: { index?: string; model?: string; json?: boolean }) => {
    try {
      if (!options.json) {
        console.log(`\nExplaining "${target}"...\n`);
      }

      const result = await runExplainCommand(target, {
        index: options.index,
        model: options.model,
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('explain', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(`Target: ${result.target} (${result.targetType})`);
      if (result.model) {
        console.log(`Model: ${result.model}`);
      }
      if (result.context) {
        const ctx = result.context;
        const parts = [];
        if (ctx.symbols) parts.push(`${ctx.symbols} symbols`);
        if (ctx.callers !== undefined) parts.push(`${ctx.callers} callers`);
        if (ctx.callees !== undefined) parts.push(`${ctx.callees} callees`);
        if (parts.length > 0) {
          console.log(`Context: ${parts.join(', ')}`);
        }
      }
      console.log('\n' + '─'.repeat(50) + '\n');
      console.log(result.explanation);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Daemon command - manages query servers for instant queries
const daemonCmd = program
  .command('daemon')
  .description('Manage query daemon servers (keeps index in memory for instant queries)');

daemonCmd
  .command('start [index]')
  .description('Start the query daemon for an index (auto-detected if not specified)')
  .option('-j, --json', 'Output as JSON')
  .action(async (indexName: string | undefined, options: { json?: boolean }) => {
    try {
      const result = await runDaemonStartCommand(indexName, {
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('daemon-start', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`Failed to start daemon: ${result.error}`);
        process.exit(1);
      }

      if (result.error === 'Daemon is already running') {
        console.log(`Daemon for "${result.daemon!.indexName}" is already running (PID: ${result.daemon!.pid})`);
      } else {
        console.log(`Started daemon for "${result.daemon!.indexName}" (PID: ${result.daemon!.pid})`);
        console.log(`Socket: ${result.daemon!.socketPath}`);
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

daemonCmd
  .command('stop [index]')
  .description('Stop the query daemon for an index (auto-detected if not specified)')
  .option('-j, --json', 'Output as JSON')
  .action(async (indexName: string | undefined, options: { json?: boolean }) => {
    try {
      const result = await runDaemonStopCommand(indexName, {
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('daemon-stop', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`Failed to stop daemon: ${result.error}`);
        process.exit(1);
      }

      if (result.stopped) {
        console.log('Daemon stopped.');
      } else {
        console.log(result.error || 'Daemon was not running.');
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

daemonCmd
  .command('list')
  .description('List running query daemons')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const result = await runDaemonListCommand({
        json: options.json,
      });

      if (options.json) {
        console.log(formatAsJson('daemon-list', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`Failed to list daemons: ${result.error}`);
        process.exit(1);
      }

      if (!result.daemons || result.daemons.length === 0) {
        console.log('No query daemons running.');
        return;
      }

      console.log('Running query daemons:\n');
      for (const daemon of result.daemons) {
        console.log(`  ${daemon.indexName}`);
        console.log(`    PID: ${daemon.pid}`);
        console.log(`    Started: ${daemon.startedAt}`);
        console.log(`    Socket: ${daemon.socketPath}`);
        console.log();
      }
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

daemonCmd
  .command('query <method> [params...]')
  .description('Send a query to the daemon (e.g., daemon query search "my query")')
  .option('-i, --index <name>', 'Index to query (auto-detected if not specified)')
  .option('-j, --json', 'Output as JSON')
  .action(async (method: string, paramsArray: string[], options: { index?: string; json?: boolean }) => {
    try {
      // Parse params from command line
      // Format: key=value pairs or just values for positional params
      const params: Record<string, unknown> = {};

      // Handle common query patterns
      const firstParam = paramsArray[0];
      if (method === 'search' && paramsArray.length > 0 && firstParam && !firstParam.includes('=')) {
        params.query = firstParam;
        paramsArray = paramsArray.slice(1);
      } else if (['callers', 'impact', 'similar'].includes(method) && paramsArray.length > 0 && firstParam && !firstParam.includes('=')) {
        params.symbol = firstParam;
        paramsArray = paramsArray.slice(1);
      } else if (method === 'deps' && paramsArray.length > 0 && firstParam && !firstParam.includes('=')) {
        params.file = firstParam;
        paramsArray = paramsArray.slice(1);
      }

      // Parse remaining key=value pairs
      for (const param of paramsArray) {
        const [key, value] = param.split('=');
        if (key && value !== undefined) {
          // Try to parse as number or boolean
          if (value === 'true') params[key] = true;
          else if (value === 'false') params[key] = false;
          else if (!isNaN(Number(value))) params[key] = Number(value);
          else params[key] = value;
        }
      }

      const result = await runDaemonQueryCommand(method, params, options.index, {
        json: options.json,
      });

      if (options.json || !result.success) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      }

      // Pretty print the result
      console.log(JSON.stringify(result.result, null, 2));
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

daemonCmd
  .command('logs [index]')
  .description('View daemon logs')
  .option('-n, --tail <n>', 'Show last N lines', '50')
  .option('-j, --json', 'Output as JSON')
  .action(async (indexName: string | undefined, options: { tail?: string; json?: boolean }) => {
    try {
      const result = await runDaemonLogsCommand(indexName, {
        json: options.json,
        tail: options.tail ? parseInt(options.tail, 10) : undefined,
      });

      if (options.json) {
        console.log(formatAsJson('daemon-logs', result));
        process.exit(result.success ? 0 : 1);
      }

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(result.logs);
    } catch (err) {
      if (options.json) {
        console.log(formatAsJson('error', err as Error));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Worktree commands - lightweight manifest-based views over shared chunk store
const worktreeCmd = program
  .command('worktree')
  .description('Manage worktree manifests for fast branch forking');

worktreeCmd
  .command('create <path>')
  .description('Create a new worktree from a directory (full index into shared store + manifest)')
  .requiredOption('-n, --name <name>', 'Worktree name')
  .option('-b, --branch <branch>', 'Git branch name')
  .option('--project <name>', 'Project to create the worktree under')
  .option('-j, --json', 'Output as JSON')
  .action(async (path: string, options: { name: string; branch?: string; project?: string; json?: boolean }) => {
    try {
      const result = await runWorktreeCreateCommand({
        name: options.name,
        path,
        branch: options.branch,
        project: options.project,
        json: options.json,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

worktreeCmd
  .command('fork <parent>')
  .description('Fork an existing worktree (fast — only processes changed files)')
  .requiredOption('-n, --name <name>', 'New worktree name')
  .requiredOption('-p, --path <path>', 'Path to the new branch directory')
  .option('-b, --branch <branch>', 'Git branch name')
  .option('--project <name>', 'Project scope for parent lookup')
  .option('-j, --json', 'Output as JSON')
  .action(async (parent: string, options: { name: string; path: string; branch?: string; project?: string; json?: boolean }) => {
    try {
      const result = await runWorktreeForkCommand({
        parent,
        name: options.name,
        path: options.path,
        branch: options.branch,
        project: options.project,
        json: options.json,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

worktreeCmd
  .command('list')
  .description('List all worktrees with stats')
  .option('--project <name>', 'Filter worktrees by project')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { project?: string; json?: boolean }) => {
    try {
      const worktrees = await runWorktreeListCommand({ project: options.project, json: options.json });

      if (options.json) {
        console.log(JSON.stringify(worktrees, null, 2));
        process.exit(0);
      }

      if (worktrees.length === 0) {
        console.log('No worktrees found.');
        return;
      }

      console.log(`\n  Worktrees (${worktrees.length}):\n`);
      for (const wt of worktrees) {
        const parent = wt.parentId ? ` (forked)` : '';
        const branch = wt.branch ? ` [${wt.branch}]` : '';
        console.log(`  ${wt.name}${branch}${parent}`);
        console.log(`    Status: ${wt.status}  Files: ${wt.fileCount}  Chunks: ${wt.chunkCount}`);
        if (wt.rootPath) console.log(`    Path: ${wt.rootPath}`);
        console.log('');
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

worktreeCmd
  .command('diff <a> <b>')
  .description('Show file differences between two worktrees')
  .option('-j, --json', 'Output as JSON')
  .action(async (a: string, b: string, options: { json?: boolean }) => {
    try {
      const diffs = await runWorktreeDiffCommand(a, b, { json: options.json });

      if (options.json) {
        console.log(JSON.stringify(diffs, null, 2));
        process.exit(0);
      }

      if (diffs.length === 0) {
        console.log('No differences found.');
        return;
      }

      const symbols: Record<string, string> = {
        added: '+',
        deleted: '-',
        modified: '~',
      };

      console.log(`\n  Diff: ${a} ↔ ${b} (${diffs.length} changes)\n`);
      for (const d of diffs) {
        console.log(`  ${symbols[d.changeType] || '?'} ${d.path}`);
      }
      console.log('');
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

worktreeCmd
  .command('delete <name>')
  .description('Delete a worktree (shared chunks remain for other worktrees)')
  .option('-j, --json', 'Output as JSON')
  .action(async (name: string, options: { json?: boolean }) => {
    try {
      const deleted = await runWorktreeDeleteCommand(name, { json: options.json });

      if (options.json) {
        console.log(JSON.stringify({ success: deleted }));
        process.exit(deleted ? 0 : 1);
      }

      if (deleted) {
        console.log(`Deleted worktree "${name}".`);
      } else {
        console.error(`Worktree "${name}" not found.`);
        process.exit(1);
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

worktreeCmd
  .command('update <name>')
  .description('Incrementally update a worktree from its filesystem path')
  .option('-j, --json', 'Output as JSON')
  .action(async (name: string, options: { json?: boolean }) => {
    try {
      const result = await runWorktreeUpdateCommand(name, { json: options.json });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

worktreeCmd
  .command('gc')
  .description('Garbage-collect orphaned shared chunks not referenced by any worktree')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const deleted = await runWorktreeGcCommand({ json: options.json });

      if (options.json) {
        console.log(JSON.stringify({ chunksDeleted: deleted }));
        process.exit(0);
      }

      if (deleted > 0) {
        console.log(`Garbage collected ${deleted} orphaned shared chunk(s).`);
      } else {
        console.log('No orphaned shared chunks found.');
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Project commands - multi-project namespacing and isolation
const projectCmd = program
  .command('project')
  .description('Manage projects for namespace isolation and per-project configuration');

projectCmd
  .command('create <name>')
  .description('Create a new project with its own embedding model configuration')
  .option('-m, --model <model>', 'Embedding model (defaults to global config)')
  .option('-r, --repo <url>', 'Git remote URL')
  .option('--display-name <name>', 'Human-readable display name')
  .option('-j, --json', 'Output as JSON')
  .action(async (name: string, options: { model?: string; repo?: string; displayName?: string; json?: boolean }) => {
    try {
      const project = await runProjectCreateCommand({
        name,
        model: options.model,
        repo: options.repo,
        displayName: options.displayName,
        json: options.json,
      });

      if (options.json) {
        console.log(JSON.stringify(project, null, 2));
        process.exit(0);
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

projectCmd
  .command('list')
  .description('List all projects')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const projects = await runProjectListCommand({ json: options.json });

      if (options.json) {
        console.log(JSON.stringify(projects, null, 2));
        process.exit(0);
      }

      if (projects.length === 0) {
        console.log('No projects found.');
        return;
      }

      console.log(`\n  Projects (${projects.length}):\n`);
      for (const p of projects) {
        const display = p.displayName ? ` (${p.displayName})` : '';
        const repo = p.repoUrl ? `  Repo: ${p.repoUrl}` : '';
        console.log(`  ${p.name}${display}`);
        console.log(`    Model: ${p.model}${repo}`);
        console.log('');
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

projectCmd
  .command('info <name>')
  .description('Show project details, stats, and worktrees')
  .option('-j, --json', 'Output as JSON')
  .action(async (name: string, options: { json?: boolean }) => {
    try {
      const info = await runProjectInfoCommand(name, { json: options.json });

      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        process.exit(0);
      }

      const { project: p, stats: s, worktrees } = info;
      console.log(`\nProject: ${p.name}`);
      if (p.displayName) console.log(`  Display name: ${p.displayName}`);
      console.log(`  Model: ${p.model}`);
      if (p.repoUrl) console.log(`  Repo: ${p.repoUrl}`);
      console.log(`  Chunk config: ${p.chunkMaxTokens} tokens, ${p.chunkOverlap} overlap`);
      console.log(`  Worktrees: ${s.worktreeCount}`);
      console.log(`  Total files: ${s.totalFiles.toLocaleString()} (across all worktrees)`);
      console.log(`  Unique files: ${s.uniqueFiles.toLocaleString()}`);
      console.log(`  Total chunks: ${s.totalChunks.toLocaleString()} (across all worktrees)`);
      console.log(`  Unique chunks: ${s.uniqueChunks.toLocaleString()} (in shared store)`);
      if (s.storageSavingsPercent > 0) {
        console.log(`  Storage savings: ${s.storageSavingsPercent}%`);
      }

      if (worktrees.length > 0) {
        console.log(`\n  Worktrees:`);
        for (const wt of worktrees) {
          const branch = wt.branch ? ` [${wt.branch}]` : '';
          console.log(`    ${wt.name}${branch} — ${wt.status}, ${wt.fileCount} files, ${wt.chunkCount} chunks`);
        }
      }
      console.log('');
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

const projectConfigCmd = projectCmd
  .command('config <name>')
  .description('Manage per-project configuration');

projectConfigCmd
  .command('set <key> <value>')
  .description('Set a project config value (model, chunkMaxTokens, chunkOverlap, repo, displayName, excludePatterns)')
  .option('-j, --json', 'Output as JSON')
  .action(async (key: string, value: string, options: { json?: boolean }) => {
    try {
      // The parent command captures <name>, access it via parent args
      const projectName = projectConfigCmd.args[0];
      if (!projectName) throw new Error('Project name is required');

      const updated = await runProjectConfigSetCommand(projectName, key, value, { json: options.json });

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        process.exit(0);
      }

      if (updated) {
        console.log(`Updated "${key}" for project "${updated.name}".`);
      } else {
        console.error('Project not found.');
        process.exit(1);
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

projectCmd
  .command('delete <name>')
  .description('Delete a project (cascade deletes all worktrees and manifests)')
  .option('-j, --json', 'Output as JSON')
  .action(async (name: string, options: { json?: boolean }) => {
    try {
      const deleted = await runProjectDeleteCommand(name, { json: options.json });

      if (options.json) {
        console.log(JSON.stringify({ success: deleted }));
        process.exit(deleted ? 0 : 1);
      }

      if (deleted) {
        console.log(`Deleted project "${name}" and all its worktrees.`);
      } else {
        console.error(`Project "${name}" not found.`);
        process.exit(1);
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// Server commands - shared HTTP query server
const serverCmd = program
  .command('server')
  .description('Manage the lgrep query server (shared hosted-query layer for Postgres-backed cloud deployment)');

serverCmd
  .command('bootstrap <path>')
  .description('Bootstrap a hosted Postgres project with one main worktree, optional additional worktrees, and a scoped token')
  .option('--profile <name>', 'Profile name to configure', 'cloud')
  .option('--project <name>', 'Project name (defaults to the repo directory name)')
  .option('--main-name <name>', 'Name for the main worktree', 'main')
  .option('--branch <branch>', 'Branch name for the main worktree')
  .option('--worktree <spec...>', 'Additional worktree spec: "name|/path/to/worktree" or "name|/path/to/worktree|branch"')
  .option('--database-url-env <name>', 'Environment variable holding the Postgres URL', 'LGREP_DATABASE_URL')
  .option('--database-url <url>', 'Postgres URL to use for this bootstrap run')
  .option('--token-label <label>', 'Label for the scoped hosted token')
  .option('--port <port>', 'Suggested hosted query server port', '8420')
  .option('--server-url <url>', 'Public URL that clients should use for the hosted server')
  .option('-j, --json', 'Output as JSON')
  .action(async (path: string, options: {
    profile?: string;
    project?: string;
    mainName?: string;
    branch?: string;
    worktree?: string[];
    databaseUrlEnv?: string;
    databaseUrl?: string;
    tokenLabel?: string;
    port?: string;
    serverUrl?: string;
    json?: boolean;
  }) => {
    try {
      const result = await runServerBootstrapCommand({
        path,
        profile: options.profile,
        project: options.project,
        mainName: options.mainName,
        branch: options.branch,
        worktrees: options.worktree,
        databaseUrlEnv: options.databaseUrlEnv,
        databaseUrl: options.databaseUrl,
        tokenLabel: options.tokenLabel,
        port: options.port ? parseInt(options.port, 10) : undefined,
        serverUrl: options.serverUrl,
        json: options.json,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      }

      console.log('\nHosted project bootstrapped.\n');
      console.log(`  Profile: ${result.profile}`);
      console.log(`  Config: ${result.configPath}`);
      console.log(`  Project: ${result.project.name}${result.project.created ? ' (created)' : ' (existing)'}`);
      console.log(`  Main worktree: ${result.mainWorktree.name} (${result.mainWorktree.action})`);
      for (const worktree of result.additionalWorktrees) {
        console.log(`  Additional worktree: ${worktree.name} (${worktree.action})`);
      }
      console.log('\nHosted token');
      console.log(`  Label: ${result.token.label}`);
      console.log(`  Token ID: ${result.token.id}`);
      console.log(`  Store: ${result.token.path}`);
      console.log('\nSave this token now. It will not be shown again:\n');
      console.log(result.token.value);
      console.log('\nServer');
      console.log(`  Start: ${result.server.startCommand}`);
      console.log(`  tmux:  ${result.server.tmuxCommand}`);
      console.log(`  Status: ${result.server.statusCommand}`);
      console.log('\nClient env');
      console.log(`  export ${result.client.serverUrlEnv}="${result.server.serverUrl}"`);
      console.log(`  export ${result.client.tokenEnv}="${result.token.value}"`);
      console.log('\nExample commands');
      for (const command of result.client.exampleCommands) {
        console.log(`  ${command}`);
      }
      if (result.notes.length > 0) {
        console.log('\nNotes');
        for (const note of result.notes) {
          console.log(`  - ${note}`);
        }
      }
      console.log('');
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

serverCmd
  .command('install-remote <sshTarget>')
  .description('Provision a hosted lgrep server over SSH and optionally configure this machine to use it globally')
  .requiredOption('--server-url <url>', 'Public URL that local clients should use for the hosted server')
  .option('--database-url <url>', 'Postgres URL for the remote service (otherwise read from LGREP_DATABASE_URL)')
  .option('--database-url-env <name>', 'Environment variable holding the Postgres URL locally', 'LGREP_DATABASE_URL')
  .option('--profile <name>', 'Remote lgrep profile name to initialize', 'cloud')
  .option('--service-name <name>', 'Service name for launchd/systemd', 'lgrep-server')
  .option('--port <port>', 'Remote hosted query server port', '8420')
  .option('--token-label <label>', 'Label for the remotely provisioned bearer token')
  .option('--install-target <target>', 'Local install target after provisioning (claude, codex, mcp, all)', 'all')
  .option('--skip-local-install', 'Do not update this machine after provisioning the remote host')
  .option('-f, --force', 'Overwrite existing MCP configuration if local install includes mcp')
  .option('-j, --json', 'Output as JSON')
  .action(async (sshTarget: string, options: {
    serverUrl: string;
    databaseUrl?: string;
    databaseUrlEnv?: string;
    profile?: string;
    serviceName?: string;
    port?: string;
    tokenLabel?: string;
    installTarget?: 'claude' | 'codex' | 'mcp' | 'all';
    skipLocalInstall?: boolean;
    force?: boolean;
    json?: boolean;
  }) => {
    try {
      const result = await runServerInstallRemoteCommand({
        sshTarget,
        serverUrl: options.serverUrl,
        databaseUrl: options.databaseUrl,
        databaseUrlEnv: options.databaseUrlEnv,
        remoteProfile: options.profile,
        serviceName: options.serviceName,
        port: options.port ? parseInt(options.port, 10) : undefined,
        tokenLabel: options.tokenLabel,
        installTarget: options.installTarget,
        skipLocalInstall: options.skipLocalInstall,
        force: options.force,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log('\nRemote hosted install complete.\n');
      console.log(`  SSH target: ${result.sshTarget}`);
      console.log(`  Package: ${result.packageSpecifier}`);
      console.log(`  Hosted URL: ${result.serverUrl}`);
      console.log(`  Remote service: ${result.remote.serviceName}`);
      console.log(`  Service manager: ${result.remote.serviceManager}`);
      console.log(`  Service path: ${result.remote.servicePath}`);
      console.log(`  Start script: ${result.remote.startScript}`);
      console.log(`  Token store: ${result.remote.tokenFile}`);
      console.log(`  Health URL: ${result.remote.healthUrl}`);

      if (result.localInstall) {
        console.log('\nLocal machine');
        if (result.localInstall.clientConfigPath) {
          console.log(`  Client config: ${result.localInstall.clientConfigPath}`);
        }
        if (result.localInstall.userClaudeMdPath) {
          console.log(`  Claude guidance: ${result.localInstall.userClaudeMdPath}`);
        }
        if (result.localInstall.codexUserPath) {
          console.log(`  Codex guidance: ${result.localInstall.codexUserPath}`);
        }
        if (result.localInstall.mcpSettingsPath) {
          console.log(`  MCP config: ${result.localInstall.mcpSettingsPath}`);
        }
      }

      if (result.notes.length > 0) {
        console.log('\nNotes');
        for (const note of result.notes) {
          console.log(`  - ${note}`);
        }
      }
      console.log('');
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

serverCmd
  .command('start')
  .description('Start the lgrep query server')
  .option('--port <port>', 'Port to listen on', '8420')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { port?: string; json?: boolean }) => {
    try {
      const result = await runServerStartCommand({
        port: options.port ? parseInt(options.port, 10) : undefined,
        json: options.json,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.success) process.exit(1);
        return;
      }

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

serverCmd
  .command('status')
  .description('Show query server status and health')
  .option('--port <port>', 'Port to check', '8420')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { port?: string; json?: boolean }) => {
    try {
      const result = await runServerStatusCommand({
        port: options.port ? parseInt(options.port, 10) : undefined,
        json: options.json,
      }) as Record<string, unknown>;

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      }

      if (result['status'] === 'not_running') {
        console.log(`Server not running at ${result['url']}`);
        return;
      }

      console.log(`\nServer Status: ${result['status']}`);
      console.log(`  Uptime: ${result['uptime']}`);
      const auth = result['auth'] as Record<string, unknown> | undefined;
      if (auth) {
        console.log(`  Auth: ${auth['enabled'] ? auth['mode'] : 'disabled'}`);
        if (auth['tokenFile']) console.log(`    Token store: ${auth['tokenFile']}`);
        if (typeof auth['tokenCount'] === 'number') console.log(`    Scoped tokens: ${auth['tokenCount']}`);
      }
      const pg = result['postgres'] as Record<string, unknown> | undefined;
      if (pg) {
        console.log(`  Postgres: ${pg['connected'] ? 'connected' : 'disconnected'}`);
        console.log(`    Pool: ${pg['active_connections']} active / ${pg['idle_connections']} idle`);
      }
      const stats = result['stats'] as Record<string, unknown> | undefined;
      if (stats) {
        console.log(`  Projects: ${stats['projects']}`);
        console.log(`  Worktrees: ${stats['worktrees']}`);
        console.log(`  Shared chunks: ${stats['shared_chunks']}`);
      }
      console.log('');
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

const serverTokenCmd = serverCmd
  .command('token')
  .description('Manage scoped bearer tokens for the hosted query service');

serverTokenCmd
  .command('create')
  .description('Create a scoped bearer token for one or more projects')
  .requiredOption('--label <label>', 'Human-readable label for the token')
  .option('--projects <names>', 'Comma-separated project names or IDs')
  .option('--worktrees <names>', 'Optional comma-separated worktree names or IDs')
  .option('--all-projects', 'Allow access to all projects')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: {
    label: string;
    projects?: string;
    worktrees?: string;
    allProjects?: boolean;
    json?: boolean;
  }) => {
    try {
      const result = await runServerTokenCreateCommand(options);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      }

      console.log('\nCreated hosted query token:\n');
      console.log(`  Label: ${result.label}`);
      console.log(`  Token ID: ${result.id}`);
      console.log(`  Projects: ${result.projects?.join(', ') ?? 'all'}`);
      console.log(`  Worktrees: ${result.worktrees?.join(', ') ?? 'all visible in scope'}`);
      console.log(`  Token store: ${result.path}`);
      console.log('\nSave this token now. It will not be shown again:\n');
      console.log(result.token);
      console.log('');
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

serverTokenCmd
  .command('list')
  .description('List configured hosted query tokens without revealing secrets')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const result = await runServerTokenListCommand();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      }

      if (result.tokens.length === 0) {
        console.log(`No scoped tokens found in ${result.path}.`);
        return;
      }

      console.log(`\nScoped hosted query tokens (${result.tokens.length})`);
      console.log(`  Store: ${result.path}`);
      console.log('');
      for (const token of result.tokens) {
        console.log(`  ${token.label} (${token.id})`);
        console.log(`    Projects: ${token.projects?.join(', ') ?? 'all'}`);
        console.log(`    Worktrees: ${token.worktrees?.join(', ') ?? 'all visible in scope'}`);
        console.log(`    Created: ${token.createdAt}`);
        console.log('');
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

// GC command - garbage collect orphaned shared data
program
  .command('gc')
  .description('Garbage-collect orphaned shared chunks, code intelligence, and stale worktrees')
  .option('--dry-run', 'Report what would be deleted without actually deleting')
  .option('--stale-days <days>', 'Also clean up worktrees not updated in N days')
  .option('--project <name>', 'Scope GC to a specific project')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: { dryRun?: boolean; staleDays?: string; project?: string; json?: boolean }) => {
    try {
      const result = await runGcCommand({
        dryRun: options.dryRun,
        staleDays: options.staleDays ? parseInt(options.staleDays, 10) : undefined,
        project: options.project,
        json: options.json,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      }
    } catch (err) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: (err as Error).message }));
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  });

program.parse();
