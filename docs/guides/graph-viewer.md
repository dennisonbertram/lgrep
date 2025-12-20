# Graph Viewer (lgrep `graph`)

`lgrep graph` starts a **localhost-only** web UI that visualizes your indexed code as a graph.

## What it shows

- **Dependencies mode** (`--mode deps`, default): file → file import edges (from code-intel dependencies)
- **Calls mode** (`--mode calls`): file → file call edges (best-effort, from code-intel call edges where a callee file is known)

## Usage

```bash
# Auto-detect index from current directory
lgrep graph

# Specify index explicitly
lgrep graph --index my-project

# Switch mode
lgrep graph --mode calls

# Include external dependencies (deps mode)
lgrep graph --external

# Don’t open browser automatically
lgrep graph --no-open
```

## How it works (implementation overview)

- **CLI/server**: `src/cli/commands/graph.ts`
  - starts an HTTP server bound to `127.0.0.1` on port `0` (OS chooses an available high port)
  - serves static assets from `dist/viewer/`
  - exposes:
    - `GET /api/indexes` → list indexes
    - `GET /api/graph?index=...&mode=deps|calls&external=0|1` → graph JSON
- **Frontend**: `viewer/` (React + Vite + Tailwind + shadcn-style components)
  - rendered via Cytoscape.js (`cytoscape-fcose` layout)
  - fetches graph data from the server endpoints above

## Build notes

`npm run build` produces:

- CLI bundles under `dist/`
- Viewer static assets under `dist/viewer/` (included in the published package via `package.json#files`)

