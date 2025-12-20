# Devlog: Graph viewer (`lgrep graph`)

Date: 2025-12-20

## Summary

Implemented a new `lgrep graph` command that starts a localhost web UI on an OS-chosen high port and visualizes:

- file dependency graph (imports)
- file call graph (best-effort where callee file is known)

## Key changes

- Added `src/cli/commands/graph.ts` with:
  - local HTTP server (`127.0.0.1`, port `0` by default)
  - `GET /api/indexes` and `GET /api/graph`
  - static serving of bundled viewer assets from `dist/viewer/`
- Added `viewer/` React + Vite app (Tailwind + shadcn-style components) using Cytoscape.js
- Wired build to output viewer assets into `dist/viewer/` and include them in published files
- Added unit tests for graph edge aggregation + external dep filtering

## Notes / tradeoffs

- Call graph is currently **file-level** (not symbol-level) to keep payload size reasonable and stay fast.
- Viewer is static assets shipped with the CLI, so `lgrep graph` works without a separate dev server.

