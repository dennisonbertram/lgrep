#!/usr/bin/env node
/**
 * Standalone MCP server entry point for lgrep.
 */

import { runMCPServer } from './server.js';

// Run the server
runMCPServer().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
