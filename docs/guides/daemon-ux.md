# Daemon & Auto-Index UX

Two additions improve the long-running daemon/watch experience:

- **`.lgrep.json` at the repository root** – Drop a JSON file with `{ "index": "my-project", "root": "src" }` (paths are relative to the config file) and every CLI command, watcher, or intent request will pick up the preferred index automatically. Detecting the config occurs before the normal `listIndexes` scan, so commands no longer require `--index` when you are inside a configured repo.

- **New auto-indexed commands** – The new `dead`, `similar`, `cycles`, `breaking`, `unused-exports`, and `rename` commands reuse the same auto-detection logic and keep daemon-style feedback (spinners, watch-friendly logging) when a watch process keeps the database warm.

### `.lgrep.json` example

```json
{
  "index": "frontend-ui",
  "root": "src"
}
```

Place this alongside your `package.json`. The `root` key enables the CLI to figure out which part of the repo is covered by the index; `index` can reference a custom index name if you run multiple indexes out of the same repo.

### Running with the daemon

Use `lgrep watch <index>` as before. When a watcher is running, commands like `lgrep intent` and `lgrep dead` reuse the warmed-up LanceDB files and skip re-indexing work unless the watch updates the data. If the daemon is stopped, the CLI still auto-detects the index via `.lgrep.json` or by tracing parent directories, so you can run one-off analyses without remembering indexes or paths.
