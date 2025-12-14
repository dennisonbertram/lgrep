import { Command } from 'commander';
import { runConfigCommand } from './commands/config.js';
import { runListCommand } from './commands/list.js';
import { runDeleteCommand } from './commands/delete.js';
import { runIndexCommand } from './commands/index.js';
import { runSearchCommand } from './commands/search.js';
import { runAnalyzeCommand } from './commands/analyze.js';
import { formatAsJson } from './commands/json-formatter.js';
import { openDatabase, deleteIndex } from '../storage/lance.js';
import { getDbPath } from './utils/paths.js';

const program = new Command();

program
  .name('mgrep')
  .description('Local semantic search CLI - privacy-first, mixedbread.ai quality without the cloud')
  .version('0.1.0');

// Index command - fully implemented
program
  .command('index <path>')
  .description('Index files in a directory for semantic search')
  .option('-n, --name <name>', 'Name for the index')
  .option('-u, --update', 'Update existing index incrementally (skip unchanged files)')
  .option('-f, --force', 'Delete and recreate index if it exists')
  .option('-j, --json', 'Output as JSON')
  .action(async (path: string, options: { name?: string; update?: boolean; force?: boolean; json?: boolean }) => {
    try {
      // Validate flag conflicts
      if (options.update && options.force) {
        throw new Error('Cannot use both --update and --force flags together');
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

      if (!options.json && !options.update) {
        console.log(`Indexing ${path}...`);
      } else if (!options.json && options.update) {
        console.log(`Updating index for ${path}...`);
      }

      const result = await runIndexCommand(path, {
        name: options.name,
        mode: options.update ? 'update' : 'create',
        json: options.json,
        showProgress: !options.json,
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
  .option('-i, --index <name>', 'Index to search (required)')
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

program.parse();
