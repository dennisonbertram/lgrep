# Learnings

- **Intent routing unlocks natural language** – Building `parseIntent` allowed us to map conversational prompts to precise commands without a separate LLM layer. Keeping tests for the heuristic ensures we can tweak keywords without risking regressions.
- **Metadata keeps similar code & unused exports cheapest** – Storing `bodyHash` and `resolvedPath` during indexing means all the new commands can run purely off LanceDB tables without re-parsing every time.
- **Config-first auto-detection simplifies UX** – `.lgrep.json` lets every command, watcher, and intent request re-use a single index name/root pair, so users don't need to memorize `--index` flags when they work in configured repos.
