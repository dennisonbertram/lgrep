# Project Rename: mgrep → lgrep

## Summary
Successfully renamed the project from "mgrep" to "lgrep" (Local grep - privacy-first semantic search).

## Changes Made

### 1. Package Configuration
- **package.json**: Updated `name` field to "lgrep"
- **package.json**: Updated `bin` field from `mgrep` to `lgrep`
- Regenerated package-lock.json

### 2. Core Source Files
- **src/cli/utils/paths.ts**: 
  - Renamed `getMgrepHome()` → `getLgrepHome()`
  - Updated environment variable `MGREP_HOME` → `LGREP_HOME`
  - Updated all path references from `.mgrep` → `.lgrep`
  
- **src/storage/config.ts**:
  - Renamed interface `MgrepConfig` → `LgrepConfig`
  - Updated all type references

- **src/index.ts**:
  - Updated exports to use `getLgrepHome` and `LgrepConfig`

- **src/cli/index.ts**:
  - Updated CLI name from "mgrep" to "lgrep"
  - Updated all user-facing messages

### 3. Commands
- **src/cli/commands/install.ts**:
  - Updated skill directory from `mgrep-search` → `lgrep-search`
  - Updated hook script name from `mgrep-check.sh` → `lgrep-check.sh`
  - Updated interface property `projectClaudeAlreadyHasMgrep` → `projectClaudeAlreadyHasLgrep`
  - Updated all string references in messages

- **src/cli/commands/context.ts**: Updated error messages
- **src/cli/commands/list.ts**: Updated help text

### 4. Templates
- **src/templates/skill.md**:
  - Updated skill name from `mgrep-search` → `lgrep-search`
  - Updated all command examples
  - Updated all references in documentation

- **src/templates/mgrep-check.sh** → **src/templates/lgrep-check.sh**:
  - Renamed file
  - Updated all script content

- **src/templates/claude-md-section.md**: Updated all references
- **src/templates/README.md**: Updated all references

### 5. Documentation
- **CLAUDE.md**: Updated all references
- **SETUP_COMMAND.md**: Updated all references
- **INCREMENTAL_INDEXING.md**: Updated all references
- **docs/JSON_OUTPUT_GUIDE.md**: Updated all references
- **.gitignore**: Updated comment

### 6. Test Files
All test files updated:
- Environment variable references: `MGREP_HOME` → `LGREP_HOME`
- Function references: `getMgrepHome()` → `getLgrepHome()`
- Type references: `MgrepConfig` → `LgrepConfig`
- Skill name: `mgrep-search` → `lgrep-search`
- Interface properties: `projectClaudeAlreadyHasMgrep` → `projectClaudeAlreadyHasLgrep`

### 7. Build & Verification
- ✅ All TypeScript files compile successfully
- ✅ Build completes without errors
- ✅ Tests run (559 passing, 2 pre-existing failures unrelated to rename)
- ✅ No remaining "mgrep" references in source code

## Breaking Changes
Users will need to:
1. Update their global installation: `npm install -g lgrep`
2. Update any scripts/aliases that reference `mgrep` command
3. Environment variables: `MGREP_HOME` → `LGREP_HOME`
4. Data directories will need migration from:
   - `~/.mgrep` → `~/.lgrep` (or platform-specific equivalent)
   - Or set `LGREP_HOME` to point to old data directory

## New Branding
**lgrep** = **L**ocal grep - emphasizing privacy-first, local-only semantic search
