import { Command } from 'commander';
import { runConfigCommand } from './commands/config.js';
import { runListCommand } from './commands/list.js';
import { runDeleteCommand } from './commands/delete.js';
import { runIndexCommand } from './commands/index.js';
import { runSearchCommand } from './commands/search.js';

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
  .action(async (path: string, options: { name?: string }) => {
    try {
      console.log(`Indexing ${path}...`);
      const result = await runIndexCommand(path, { name: options.name });
      console.log(`Created index "${result.indexName}"`);
      console.log(`  Files processed: ${result.filesProcessed}`);
      console.log(`  Chunks created: ${result.chunksCreated}`);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// Search command - fully implemented
program
  .command('search <query>')
  .description('Search indexed content')
  .option('-i, --index <name>', 'Index to search (required)')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .action(async (query: string, options: { index?: string; limit?: string }) => {
    try {
      const result = await runSearchCommand(query, {
        index: options.index,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });

      if (result.results.length === 0) {
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
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// List command - fully implemented
program
  .command('list')
  .description('List all indexes')
  .action(async () => {
    try {
      const output = await runListCommand();
      console.log(output);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// Delete command - fully implemented
program
  .command('delete <name>')
  .description('Delete an index')
  .option('-f, --force', 'Skip confirmation')
  .action(async (name: string, options: { force?: boolean }) => {
    try {
      const output = await runDeleteCommand(name, options);
      console.log(output);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// Config command - fully implemented
program
  .command('config [key] [value]')
  .description('Get or set configuration values')
  .action(async (key?: string, value?: string) => {
    try {
      const output = await runConfigCommand(key, value);
      console.log(output);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
