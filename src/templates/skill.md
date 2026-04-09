---
name: lgrep-search
description: "Semantic code search and code-intelligence guidance for lgrep. Use when searching code by meaning, locating definitions or usages, building task context, checking refactor impact, finding dead code, or exploring dependency structure."
---

# lgrep - Semantic Code Search

## Overview

lgrep helps you search and analyze code by meaning, not just text. Use it before broad repo searches when you need:

- semantic code search
- definitions and usages
- callers and impact analysis
- dead code, unused exports, or cycles
- task-oriented context building

## Storage-Aware Behavior

- In **local mode**, `lgrep watch` can keep the current repo indexed as files change.
- In **cloud mode**, prefer the shared remote index. Do not start local watchers unless the user explicitly asks for a local index.

## Fast Path

Start with:

```bash
lgrep doctor
lgrep list
```

Then use:

```bash
lgrep search "user authentication flow"
lgrep search --definition "UserService"
lgrep search --usages "validateUser"
lgrep callers awardBadge
lgrep impact awardBadge
lgrep context "add rate limiting"
lgrep intent "what calls awardBadge"
```

## Guidance

- Prefer `lgrep intent` when the user asks in natural language.
- Prefer `lgrep context` before implementation work that spans multiple files.
- Prefer `lgrep impact` or `lgrep callers` before refactors.
- In local mode, if the repo is not indexed yet, create or update the index first.
- In cloud mode, assume the configured remote index is the source of truth unless the user asks for local indexing.
