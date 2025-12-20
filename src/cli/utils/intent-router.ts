export type IntentCommand =
  | 'callers'
  | 'impact'
  | 'dead'
  | 'cycles'
  | 'unused-exports'
  | 'breaking'
  | 'similar'
  | 'rename'
  | 'search';

export interface IntentAction {
  command: IntentCommand;
  args: string[];
  reason: string;
}

const CLEAN_PROMPT_REGEX = /[^\w\s\.:\-_\/]/g;

export function parseIntent(prompt: string): IntentAction {
  const normalized = prompt.trim();
  const lower = normalized.toLowerCase();

  const callerMatch = normalized.match(/what calls\s+["']?([\w\.\-_/]+)["']?/i);
  if (callerMatch) {
    const symbol = callerMatch[1];
    if (!symbol) {
      // Fall through to default search
      return {
        command: 'search',
        args: [normalized],
        reason: 'Could not extract symbol for callers lookup',
      };
    }
    return {
      command: 'callers',
      args: [symbol],
      reason: 'User asked what calls a symbol',
    };
  }

  if (lower.includes('call graph') || lower.includes('who calls')) {
    const tokens = normalized.replace(CLEAN_PROMPT_REGEX, ' ').split(/\s+/);
    const symbol = tokens.at(-1);
    if (symbol) {
      return {
        command: 'callers',
        args: [symbol],
        reason: 'Keywords triggered callers lookup',
      };
    }
  }

  if (lower.includes('impact') || lower.includes('what happens if')) {
    const match = normalized.match(/change\s+["']?([\w\.\-_/]+)["']?/i);
    const symbol = match?.[1] ?? normalized.split(/\s+/).pop() ?? '';
    return {
      command: 'impact',
      args: symbol ? [symbol] : [],
      reason: 'Impact-oriented question',
    };
  }

  if (lower.includes('dead code') || lower.includes('unused code')) {
    return {
      command: 'dead',
      args: [],
      reason: 'Dead code inquiry',
    };
  }

  if (lower.includes('unused exports') || lower.includes('unused export')) {
    return {
      command: 'unused-exports',
      args: [],
      reason: 'Unused export scan requested',
    };
  }

  if (lower.includes('cycles') || lower.includes('circular dependency')) {
    return {
      command: 'cycles',
      args: [],
      reason: 'Dependency cycle detection requested',
    };
  }

  if (lower.includes('similar') || lower.includes('duplicate code') || lower.includes('dup code')) {
    return {
      command: 'similar',
      args: [],
      reason: 'Similar code inquiry',
    };
  }

  if (lower.includes('breaking') || lower.includes('signature change')) {
    const match = normalized.match(/signature\s+change\s+for\s+["']?([\w\.\-_/]+)["']?/i);
    return {
      command: 'breaking',
      args: match?.[1] ? [match[1]] : [],
      reason: 'Breaking change concern',
    };
  }

  const renameMatch = normalized.match(/rename\s+["']?([\w\.\-_/]+)["']?\s+to\s+["']?([\w\.\-_/]+)["']?/i);
  if (renameMatch) {
    const oldName = renameMatch[1];
    const newName = renameMatch[2];
    if (!oldName || !newName) {
      return {
        command: 'search',
        args: [normalized],
        reason: 'Could not extract both rename names',
      };
    }
    return {
      command: 'rename',
      args: [oldName, newName],
      reason: 'Rename recovery request',
    };
  }

  return {
    command: 'search',
    args: [normalized],
    reason: 'Default semantic search',
  };
}
