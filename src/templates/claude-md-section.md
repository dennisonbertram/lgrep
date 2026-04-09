## lgrep - Semantic Code Search

Use lgrep for code exploration, context building, and refactor analysis.

### When to Use It

- Search for implementation by meaning, not only by keywords
- Find definitions, usages, callers, and impact
- Build task-specific context before editing
- Find dead code, unused exports, similar code, or cycles

### Storage-Aware Guidance

- In **local mode**, `lgrep watch` can keep the current repo indexed.
- In **cloud mode**, prefer the configured shared remote index and avoid starting local watchers unless the user asks for a local workflow.

### Quick Commands

```bash
lgrep doctor
lgrep list
lgrep search "user authentication"
lgrep search --definition "ClassName"
lgrep search --usages "functionName"
lgrep callers myFunction
lgrep impact myFunction
lgrep context "implement feature X"
lgrep intent "what calls awardBadge"
```

### Best Practices

1. Run `lgrep doctor` before debugging setup problems.
2. Use `lgrep intent` for natural-language repo questions.
3. Use `lgrep context` before making cross-cutting code changes.
4. In local mode, use watchers only when you want automatic reindexing.
5. In cloud mode, assume the remote index is the source of truth.
