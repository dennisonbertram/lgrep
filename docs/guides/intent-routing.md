# Natural Language Intent Routing

The new `lgrep intent "<prompt>"` command lets you describe what you want in plain language. The intent router maps common patterns to the more specific code‑intelligence commands:

- **Callers / Call graph** – `"what calls awardBadge"` or `"who calls X"` ➜ `callers`.
- **Impact / blast radius** – `"what happens if I change setScore"` ➜ `impact`.
- **Dead code search** – `"find dead code"` or `"show unused functions"` ➜ `dead`.
- **Dependency cycles** – `"detect circular dependencies"` ➜ `cycles`.
- **Unused exports** – `"unused exports"` ➜ `unused-exports`.
- **Similar code** – `"duplicate code"` or `"similar function bodies"` ➜ `similar`.
- **Breaking changes** – `"signature change for foo"` ➜ `breaking`.
- **Rename preview** – `"rename foo to bar"` ➜ `rename`.
- **Fallback search** – everything else uses `search`.

You can still pass `-i, --index` to target a specific index and `-l, --limit` for commands that accept a limit. By default, the intent command auto-detects the appropriate index for the current working directory (and respects the new `.lgrep.json` configuration described in the daemon guide).

```bash
lgrep intent "what calls awardBadge"         # Calls command
lgrep intent "rename getScore to fetchScore" # Rename preview
lgrep intent "find dead code" --limit 20     # Dead code scan
```

Internally, the intent router exports `parseIntent()` for deterministic tests (see `src/cli/utils/intent-router.test.ts`) and `runIntentCommand()` for the CLI glue. The heuristics live in `src/cli/utils/intent-router.ts` so you can tweak keyword matching as needed.
