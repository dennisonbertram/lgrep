# Setup Command Documentation

## Overview

The `lgrep setup` command automates the installation of Ollama and required models for lgrep to function.

## Usage

```bash
lgrep setup [options]
```

## Options

- `--skip-summarization` - Skip pulling the summarization model (llama3.2:3b)
- `--no-auto-install` - Do not attempt to auto-install Ollama, only show instructions
- `-j, --json` - Output results as JSON

## What It Does

The setup command performs the following steps:

1. **Check Ollama Installation**: Verifies if Ollama is installed on the system
2. **Auto-Install (if needed)**: Attempts to install Ollama automatically on macOS and Linux
3. **Check Ollama Status**: Verifies the Ollama service is running
4. **Pull Embedding Model**: Downloads the `mxbai-embed-large` model (required)
5. **Pull Summarization Model**: Downloads the `llama3.2:3b` model (optional)
6. **Health Check**: Verifies all models are available and ready to use

## Platform-Specific Behavior

### macOS
- Auto-installs using Homebrew if available
- Falls back to manual instructions if Homebrew is not installed

### Linux
- Auto-installs using the official Ollama installation script
- Uses `curl -fsSL https://ollama.com/install.sh | sh`

### Windows
- Does not support auto-installation
- Provides download link to https://ollama.com/download

## Examples

### Basic Setup
```bash
lgrep setup
```

Output:
```
Setting up lgrep...

  Checking Ollama installation...
  Checking Ollama status...
  Pulling embedding model: downloading 50%
  Pulling embedding model: downloading 100%
  Pulling summarization model: downloading 50%
  Pulling summarization model: downloading 100%
  Running health check...

Setup complete!
  ✓ Ollama installed
  ✓ Ollama running
  ✓ Embedding model ready
  ✓ Summarization model ready
  ✓ Health check passed

lgrep is ready to use!
```

### Skip Summarization Model
```bash
lgrep setup --skip-summarization
```

This will only pull the embedding model, skipping the optional summarization model.

### JSON Output
```bash
lgrep setup --json
```

Output:
```json
{
  "command": "setup",
  "data": {
    "success": true,
    "ollamaInstalled": true,
    "ollamaRunning": true,
    "embedModelPulled": true,
    "summarizationModelPulled": true,
    "healthCheckPassed": true
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Manual Installation (No Auto-Install)
```bash
lgrep setup --no-auto-install
```

This will check if Ollama is installed and provide manual installation instructions if not found.

## Error Handling

The command provides clear error messages and instructions when:

- Ollama is not installed and auto-install fails
- Ollama is not running (provides start command)
- Model download fails (network issues, etc.)
- Health check fails (models not available)

## Implementation Details

### Core Files

- **`src/core/ollama-setup.ts`**: Core setup logic
  - `checkOllamaInstalled()`: Checks if Ollama binary exists
  - `checkOllamaRunning()`: Tests Ollama API connectivity
  - `pullModel()`: Downloads a model with progress reporting
  - `performHealthCheck()`: Verifies models are available
  - `installOllama()`: Platform-specific installation
  - `getInstallInstructions()`: Platform-specific instructions

- **`src/cli/commands/setup.ts`**: CLI command implementation
  - Orchestrates the setup workflow
  - Provides progress reporting
  - Handles errors gracefully

### Testing

- **`src/core/ollama-setup.test.ts`**: 17 unit tests
- **`src/cli/commands/setup.test.ts`**: 9 command tests
- **`src/cli/commands/setup-integration.test.ts`**: 3 integration tests

All tests use mocks to avoid requiring actual Ollama installation.

## Configuration

The command uses models defined in `src/storage/config.ts`:

- `model`: Embedding model (default: `mxbai-embed-large`)
- `summarizationModel`: Summarization model (default: `llama3.2:3b`)

These can be changed using the `lgrep config` command.
