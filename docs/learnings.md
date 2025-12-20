# Learnings

- **Intent routing unlocks natural language** – Building `parseIntent` allowed us to map conversational prompts to precise commands without a separate LLM layer. Keeping tests for the heuristic ensures we can tweak keywords without risking regressions.
- **Metadata keeps similar code & unused exports cheapest** – Storing `bodyHash` and `resolvedPath` during indexing means all the new commands can run purely off LanceDB tables without re-parsing every time.
- **Config-first auto-detection simplifies UX** – `.lgrep.json` lets every command, watcher, and intent request re-use a single index name/root pair, so users don't need to memorize `--index` flags when they work in configured repos.
- **Multi-provider embeddings require consistent model tracking** – When switching embedding providers, the model string stored in index metadata (`handle.metadata.model`) ensures search uses the same model that indexed the data. Different providers produce incompatible vector spaces, so re-indexing is required when changing providers.
- **Groq doesn't offer embeddings** – Groq focuses on fast LLM inference only. For embeddings, OpenAI (cheapest), Cohere (multilingual), and Voyage (code-optimized) are the main external options. Voyage's `voyage-code-3` is excellent for code search.
- **Known dimensions avoid API calls** – Caching embedding dimensions for common models (e.g., `text-embedding-3-small: 1536`) avoids an extra test embedding call during initialization.
- **Tailwind v4 config requires `@config` in CSS** – When using Tailwind 4 with the PostCSS plugin, custom theme tokens (like `bg-background`) won’t resolve unless the entry CSS includes an `@config` directive pointing at the Tailwind config.
- **`setup` should pull concrete Ollama models** – Even when config uses `model: auto`, `lgrep setup` should pull a real Ollama model (`mxbai-embed-large`) rather than attempting to pull the literal string `auto`.
