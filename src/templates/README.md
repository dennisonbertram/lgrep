# lgrep Templates

This directory contains templates used by the `lgrep install` command to integrate lgrep with Claude Code and Codex-style project instructions.

## Files

- **skill.md** - Claude Code skill that teaches Claude how and when to use lgrep
- **claude-md-section.md** - Section to add to CLAUDE.md files
- **agents-md-section.md** - Section to add to AGENTS.md files
- **lgrep-check.sh** - SessionStart hook script that auto-starts watchers only in local mode

## Usage

These templates are automatically loaded and used by the `lgrep install` command. They are embedded in the built distribution and do not need to be manually copied.
