/**
 * MCP Tool definitions for lgrep commands.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };
}

/**
 * All lgrep tools exposed via MCP.
 */
export const LGREP_TOOLS: ToolDefinition[] = [
  {
    name: 'lgrep_search',
    description: 'Semantic search through indexed code. Supports semantic queries, finding usages, and finding definitions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return',
          default: 10,
        },
        diversity: {
          type: 'number',
          description: 'Diversity parameter (0.0=max diversity, 1.0=pure relevance)',
          default: 0.7,
        },
        usages: {
          type: 'string',
          description: 'Find usages of this symbol instead of semantic search',
        },
        definition: {
          type: 'string',
          description: 'Find definition of this symbol instead of semantic search',
        },
        type: {
          type: 'string',
          description: 'Filter by symbol type (function, class, interface, etc.)',
        },
      },
    },
  },
  {
    name: 'lgrep_callers',
    description: 'Show all locations that call a given function/method. Returns file:line references with caller context.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Symbol name to find callers for',
        },
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'lgrep_impact',
    description: 'Show the blast radius if you change a function - direct callers plus transitive impact through the call graph.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Symbol name to analyze impact for',
        },
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'lgrep_deps',
    description: 'Show what modules import/depend on a given module.',
    inputSchema: {
      type: 'object',
      properties: {
        module: {
          type: 'string',
          description: 'Module name or path to find dependents for',
        },
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
      },
      required: ['module'],
    },
  },
  {
    name: 'lgrep_dead',
    description: 'List functions/methods with zero callers (dead code detection).',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
        limit: {
          type: 'number',
          description: 'Maximum symbols to show',
        },
      },
    },
  },
  {
    name: 'lgrep_similar',
    description: 'Find groups of symbols with similar code (duplicate/snippet detection).',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
        limit: {
          type: 'number',
          description: 'Maximum groups to show',
        },
      },
    },
  },
  {
    name: 'lgrep_cycles',
    description: 'Detect circular import/dependency chains in the codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
      },
    },
  },
  {
    name: 'lgrep_unused_exports',
    description: 'List exports that are never imported anywhere in the codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
        limit: {
          type: 'number',
          description: 'Maximum symbols to show',
        },
      },
    },
  },
  {
    name: 'lgrep_breaking',
    description: 'Check for calls that may break when function signatures change.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
      },
    },
  },
  {
    name: 'lgrep_rename',
    description: 'Preview the impact of renaming a symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        oldName: {
          type: 'string',
          description: 'Current symbol name',
        },
        newName: {
          type: 'string',
          description: 'New symbol name',
        },
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
      },
      required: ['oldName', 'newName'],
    },
  },
  {
    name: 'lgrep_context',
    description: 'Build context for a task - selects relevant files for LLM consumption.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task description to build context for',
        },
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
        limit: {
          type: 'number',
          description: 'Maximum files to include',
          default: 15,
        },
        maxTokens: {
          type: 'number',
          description: 'Token budget',
          default: 32000,
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'lgrep_symbols',
    description: 'Quick symbol lookup by name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol name pattern',
        },
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
        kind: {
          type: 'string',
          description: 'Filter by symbol kind (function, class, method, etc.)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results',
          default: 50,
        },
      },
    },
  },
  {
    name: 'lgrep_explain',
    description: 'AI-powered explanation of a file or symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'File path or symbol name to explain',
        },
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'lgrep_stats',
    description: 'Show index statistics.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'string',
          description: 'Index name (auto-detected from current directory if not provided)',
        },
      },
    },
  },
];
