import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { openDatabase, getIndex } from '../../storage/lance.js';
import { getDbPath } from '../utils/paths.js';
import { detectIndexForDirectory } from '../utils/auto-detect.js';
import { searchSymbols, getCalls, getDependencies } from '../../storage/code-intel.js';
import { createAIProvider, detectBestProvider } from '../../core/ai-provider.js';
import { loadConfig } from '../../storage/config.js';
import type { CodeSymbol } from '../../types/code-intel.js';

/**
 * Explanation result.
 */
export interface ExplainResult {
  success: boolean;
  target: string;
  targetType: 'file' | 'symbol';
  explanation?: string;
  context?: {
    symbols?: number;
    callers?: number;
    callees?: number;
    imports?: number;
  };
  model?: string;
  error?: string;
}

/**
 * Options for explain command.
 */
export interface ExplainOptions {
  index?: string;
  model?: string;
  json?: boolean;
  showProgress?: boolean;
}

/**
 * Build prompt for file explanation.
 */
function buildFilePrompt(filePath: string, content: string, symbols: CodeSymbol[]): string {
  const symbolList = symbols.map(s => `- ${s.kind} ${s.name}${s.signature ? `: ${s.signature}` : ''}`).join('\n');

  return `You are a code documentation expert. Explain what this file does in a clear, concise way.

File: ${filePath}

Symbols defined:
${symbolList || '(no symbols extracted)'}

Code:
\`\`\`
${content.slice(0, 8000)}${content.length > 8000 ? '\n... (truncated)' : ''}
\`\`\`

Provide a concise explanation (2-4 paragraphs) covering:
1. What is the main purpose of this file?
2. What are the key functions/classes and what do they do?
3. How does this fit into the larger codebase?

Keep it practical and useful for a developer trying to understand the code.`;
}

/**
 * Build prompt for symbol explanation.
 */
function buildSymbolPrompt(
  symbol: CodeSymbol,
  callers: string[],
  callees: string[],
  fileContent: string
): string {
  // Extract the symbol's code from the file
  const lines = fileContent.split('\n');
  const start = Math.max(0, (symbol.range.start.line ?? 1) - 1);
  const end = Math.max(start + 1, symbol.range.end.line ?? start + 1);
  const symbolCode = lines.slice(start, end).join('\n');

  return `You are a code documentation expert. Explain what this ${symbol.kind} does in a clear, concise way.

Symbol: ${symbol.name}
Kind: ${symbol.kind}
File: ${symbol.relativePath}
Signature: ${symbol.signature || '(not available)'}

Code:
\`\`\`
${symbolCode.slice(0, 4000)}${symbolCode.length > 4000 ? '\n... (truncated)' : ''}
\`\`\`

${callers.length > 0 ? `Called by: ${callers.slice(0, 10).join(', ')}${callers.length > 10 ? ` (+${callers.length - 10} more)` : ''}` : 'Not called by any indexed code.'}

${callees.length > 0 ? `Calls: ${callees.slice(0, 10).join(', ')}${callees.length > 10 ? ` (+${callees.length - 10} more)` : ''}` : 'Does not call other indexed functions.'}

Provide a concise explanation (1-3 paragraphs) covering:
1. What does this ${symbol.kind} do?
2. When/why would you use it?
3. Any important details about its behavior?

Keep it practical and useful for a developer trying to understand the code.`;
}

/**
 * Run the explain command.
 */
export async function runExplainCommand(
  target: string,
  options: ExplainOptions = {}
): Promise<ExplainResult> {
  // Determine if target is a file or symbol
  const isFile = existsSync(target) || target.includes('/') || target.includes('.');
  const targetType = isFile ? 'file' : 'symbol';

  // Get AI provider
  const config = await loadConfig();
  const modelName = options.model || config.summarizationModel || detectBestProvider();

  if (!modelName || modelName === 'none') {
    return {
      success: false,
      target,
      targetType,
      error: 'No AI provider available. Set GROQ_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY',
    };
  }

  const provider = createAIProvider({ model: modelName });

  if (isFile) {
    // Explain a file
    if (!existsSync(target)) {
      return {
        success: false,
        target,
        targetType: 'file',
        error: `File not found: ${target}`,
      };
    }

    const content = await readFile(target, 'utf-8');

    // Try to get symbols from index
    let symbols: CodeSymbol[] = [];
    let indexName = options.index;

    if (!indexName) {
      const detected = await detectIndexForDirectory(process.cwd());
      if (detected) {
        indexName = detected;
      }
    }

    if (indexName) {
      try {
        const dbPath = getDbPath();
        const db = await openDatabase(dbPath);
        const handle = await getIndex(db, indexName);
        if (handle) {
          const allSymbols = await searchSymbols(db, indexName, basename(target));
          symbols = allSymbols
            .filter(s => s.filePath === target || target.endsWith(s.filePath))
            .slice(0, 100);
        }
        await db.close();
      } catch {
        // Ignore - proceed without index
      }
    }

    const prompt = buildFilePrompt(target, content, symbols);
    const explanation = await provider.generateText(prompt);

    return {
      success: true,
      target,
      targetType: 'file',
      explanation,
      context: {
        symbols: symbols.length,
      },
      model: modelName,
    };
  } else {
    // Explain a symbol
    let indexName: string = options.index ?? '';
    if (!indexName) {
      const detected = await detectIndexForDirectory(process.cwd());
      indexName = detected ?? basename(process.cwd());
    }

    const dbPath = getDbPath();
    const db = await openDatabase(dbPath);

    try {
      const handle = await getIndex(db, indexName);
      if (!handle) {
        return {
          success: false,
          target,
          targetType: 'symbol',
          error: `Index "${indexName}" not found. Run: lgrep index .`,
        };
      }

      // Find the symbol
      const symbols = (await searchSymbols(db, indexName, target)).slice(0, 10);
      const symbol = symbols.find(s => s.name === target) ?? symbols[0];

      if (!symbol) {
        return {
          success: false,
          target,
          targetType: 'symbol',
          error: `Symbol "${target}" not found in index "${indexName}"`,
        };
      }

      // Get callers and callees
      const allCalls = await getCalls(db, indexName);
      const callers = Array.from(
        new Set(
          allCalls
            .filter(c => c.calleeName === symbol.name)
            .map(c => c.callerId || c.callerFile)
            .filter((v): v is string => Boolean(v))
        )
      );

      const callees = Array.from(
        new Set(
          allCalls
            .filter(c => (symbol.id ? c.callerId === symbol.id : c.callerFile === symbol.filePath))
            .map(c => c.calleeName)
            .filter((v): v is string => Boolean(v))
        )
      );

      // Read file content
      let fileContent = '';
      if (existsSync(symbol.filePath)) {
        fileContent = await readFile(symbol.filePath, 'utf-8');
      }

      const prompt = buildSymbolPrompt(symbol, callers, callees, fileContent);
      const explanation = await provider.generateText(prompt);

      return {
        success: true,
        target,
        targetType: 'symbol',
        explanation,
        context: {
          callers: callers.length,
          callees: callees.length,
        },
        model: modelName,
      };
    } finally {
      await db.close();
    }
  }
}
