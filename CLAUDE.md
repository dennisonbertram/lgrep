# Project Configuration

## Worktree Bootstrap

Run this first in every new shell and every new worktree:

```bash
source ./init.sh
```

`init.sh` is the canonical repo bootstrap. It keeps setup simple and zero-dependency beyond the normal `git` + `node` + `npm` toolchain that this project already needs.

What it does:

1. Verifies Node.js `>= 18.17`.
2. Sets `LGREP_HOME` to `.worktree/lgrep` inside the current worktree so watchers, config, cache, and indexes stay isolated per worktree.
3. Reuses a shared npm install stored under the git common directory, keyed by the lockfile, platform, architecture, and exact Node version.
4. Uses a lock directory so multiple worktrees can bootstrap in parallel safely.
5. Adds `./node_modules/.bin` to `PATH` for the current shell.

Recommended flow:

```bash
source ./init.sh
npm run type-check
npm test
```

Prefer `source ./init.sh` over `./init.sh`. If you execute it directly, it will prepare the environment files but cannot export variables back into your current shell.

## lgrep - Semantic Code Search

Use lgrep for repo exploration, context building, and refactor analysis.

### Core Workflow

```bash
lgrep init
lgrep doctor
lgrep list
lgrep search "authentication flow"
lgrep search --definition "UserService"
lgrep search --usages "validateUser"
lgrep callers awardBadge
lgrep impact awardBadge
lgrep context "add rate limiting"
lgrep intent "what calls awardBadge"
```

### Storage-Aware Guidance

- In **local mode**, `lgrep watch` can keep the current repo indexed.
- In **cloud mode**, prefer the configured remote index and avoid starting local watchers unless a local workflow is explicitly requested.

### Useful Commands

- `lgrep init` - guided local or cloud setup
- `lgrep profile` - manage named local/cloud profiles
- `lgrep doctor` - diagnose setup, integration, and storage issues
- `lgrep install --target claude|codex|mcp|all` - install integrations
- `lgrep config` - inspect or update config values

### Configuration

```bash
lgrep profile list
lgrep config
lgrep config model
lgrep config model auto
lgrep config summarizationModel auto
```

### Best Practices

1. Run `lgrep init` for first-run setup.
2. Run `lgrep doctor` before debugging configuration problems.
3. Use `lgrep context` before large cross-file changes.
4. Use `lgrep callers` or `lgrep impact` before refactors.
5. In cloud mode, treat the shared remote index as the default source of truth.
