import { runCallersCommand } from './callers.js';
import { runImpactCommand } from './impact.js';
import { runDeadCommand } from './dead.js';
import { runCyclesCommand } from './cycles.js';
import { runUnusedExportsCommand } from './unused-exports.js';
import { runSimilarCommand } from './similar.js';
import { runBreakingCommand } from './breaking.js';
import { runRenameCommand } from './rename.js';
import { runSearchCommand } from './search.js';
import { parseIntent, type IntentAction } from '../utils/intent-router.js';
import { formatAsJson } from './json-formatter.js';

export interface IntentOptions {
  index?: string;
  json?: boolean;
  limit?: number;
}

export interface IntentResult {
  intent: IntentAction;
  payload: unknown;
  summary: string;
}

export async function runIntentCommand(
  prompt: string,
  options: IntentOptions = {}
): Promise<IntentResult> {
  const intent = parseIntent(prompt);
  let payload: unknown;
  let summary = `Running ${intent.command} command`;

  switch (intent.command) {
    case 'callers': {
      const symbol = intent.args[0];
      if (!symbol) {
        throw new Error('No symbol detected for callers intent');
      }
      payload = await runCallersCommand(symbol, {
        index: options.index,
        json: true,
        showProgress: false,
      });
      summary = `Callers for "${symbol}"`;
      break;
    }
    case 'impact': {
      const symbol = intent.args[0];
      if (!symbol) {
        throw new Error('No symbol detected for impact intent');
      }
      payload = await runImpactCommand(symbol, {
        index: options.index,
        json: true,
      });
      summary = `Impact analysis for "${symbol}"`;
      break;
    }
    case 'dead': {
      payload = await runDeadCommand({
        index: options.index,
        json: true,
        limit: options.limit,
      });
      summary = 'Dead code inspection';
      break;
    }
    case 'cycles': {
      payload = await runCyclesCommand({
        index: options.index,
        json: true,
      });
      summary = 'Dependency cycle detection';
      break;
    }
    case 'unused-exports': {
      payload = await runUnusedExportsCommand({
        index: options.index,
        json: true,
        limit: options.limit,
      });
      summary = 'Unused export scan';
      break;
    }
    case 'similar': {
      payload = await runSimilarCommand({
        index: options.index,
        json: true,
        limit: options.limit,
      });
      summary = 'Similar code clusters';
      break;
    }
    case 'breaking': {
      payload = await runBreakingCommand({
        index: options.index,
        json: true,
      });
      summary = 'Breaking signature checks';
      break;
    }
    case 'rename': {
      const [oldName, newName] = intent.args;
      if (!oldName || !newName) {
        throw new Error('Rename intent requires both old and new names');
      }
      payload = await runRenameCommand(oldName, newName, {
        index: options.index,
        json: true,
        preview: true,
        limit: options.limit,
      });
      summary = `Rename preview: "${oldName}" → "${newName}"`;
      break;
    }
    case 'search': {
      const query = intent.args[0] ?? '';
      payload = await runSearchCommand(query, {
        index: options.index,
        json: true,
        limit: options.limit,
      });
      summary = query ? `Search for "${query}"` : 'Search';
      break;
    }
  }

  return {
    intent,
    payload,
    summary,
  };
}

export function presentIntentResult(result: IntentResult, json?: boolean): void {
  if (json) {
    console.log(formatAsJson('intent', result));
    return;
  }

  console.log(`Intent detected: ${result.intent.command} (${result.intent.reason})`);
  console.log(result.summary);
  console.log('Result payload:', result.payload);
}
