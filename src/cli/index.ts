import { Command } from 'commander';
import { runConfigCommand } from './commands/config.js';
import { runListCommand } from './commands/list.js';
import { runDeleteCommand } from './commands/delete.js';
import { runIndexCommand } from './commands/index.js';
import { runSearchCommand } from './commands/search.js';
import { runAnalyzeCommand } from './commands/analyze.js';
import { runContextCommand } from './commands/context.js';
import { runWatchCommand } from './commands/watch.js';
import { runStopCommand } from './commands/stop.js';
import { runSetupCommand } from './commands/setup.js';
import { runInstallCommand } from './commands/install.js';
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
import { formatAsJson, formatContextMarkdown } from './commands/json-formatter.js';
import { openDatabase, deleteIndex } from '../storage/lance.js';
import { getDbPath } from './utils/paths.js';
import { checkFirstRun } from './utils/first-run.js';

const program = new Command();

program
  .name('lgrep')
  .description('Local semantic search CLI - privacy-first, mixedbread.ai quality without the cloud')
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
        const dbPath = getDbPath();
        const db = await openDatabase(dbPath);
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
  .option('-j, --json', 'Output as JSON')
  .action(async (query: string, options: {
    index?: string;
    limit?: string;
    diversity?: string;
    usages?: string;
    definition?: string;
    type?: string;
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
  .option('-l, --limit <n>', 'Max files to include', '15')
  .option('--max-tokens <n>', 'Token budget', '32000')
  .option('--depth <n>', 'Graph traversal depth', '2')
  .option('--summary-only', 'Exclude code snippets')
  .option('--no-approach', 'Skip approach suggestions')
  .option('--format <type>', 'Output format (json|markdown)', 'json')
  .option('-j, --json', 'JSON output (same as --format json)')
  .action(async (task: string, options: {
    index?: string;
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
  .option('-j, --json', 'Output as JSON')
  .action(async (symbol: string, options: { index?: string; json?: boolean }) => {
    try {
      const result = await runCallersCommand(symbol, {
        index: options.index,
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
  .option('-j, --json', 'Output as JSON')
  .action(async (symbol: string, options: { index?: string; json?: boolean }) => {
    try {
      const result = await runImpactCommand(symbol, {
        index: options.index,
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
  .description('Install lgrep integration with Claude Code')
  .option('--skip-skill', 'Do not create the skill')
  .option('--skip-hook', 'Do not add SessionStart hook')
  .option('--skip-claude-md', 'Do not update ~/.claude/CLAUDE.md')
  .option('--add-to-project', 'Also add lgrep instructions to project CLAUDE.md')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('-j, --json', 'Output as JSON')
  .action(async (options: {
    skipSkill?: boolean;
    skipHook?: boolean;
    skipClaudeMd?: boolean;
    addToProject?: boolean;
    yes?: boolean;
    json?: boolean;
  }) => {
    try {
      const result = await runInstallCommand({
        skipSkill: options.skipSkill,
        skipHook: options.skipHook,
        skipClaudeMd: options.skipClaudeMd,
        addToProject: options.addToProject,
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

      if (!options.skipSkill) {
        if (result.skillCreated) {
          console.log(`  ✓ Skill created at ${result.skillPath}`);
        } else if (result.skillAlreadyExists) {
          console.log(`  ○ Skill already exists at ${result.skillPath}`);
        }
      }

      if (!options.skipHook) {
        if (result.hookAdded) {
          console.log(`  ✓ SessionStart hook added to ${result.settingsPath}`);
        } else if (result.hookAlreadyExists) {
          console.log(`  ○ SessionStart hook already exists in ${result.settingsPath}`);
        }
      }

      if (!options.skipClaudeMd) {
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

      console.log('\nlgrep is now integrated with Claude Code!');
      console.log('Claude will now know to use lgrep for code search and analysis.');
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

program.parse();
