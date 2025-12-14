import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import ollama from 'ollama';

const execAsync = promisify(exec);

/**
 * Result from installation attempt.
 */
export interface InstallResult {
  success: boolean;
  method?: 'brew' | 'script' | 'manual';
  error?: string;
  instructions?: string;
}

/**
 * Result from health check.
 */
export interface HealthCheckResult {
  success: boolean;
  ollamaRunning: boolean;
  embedModelAvailable: boolean;
  summarizationModelAvailable?: boolean;
  error?: string;
}

/**
 * Result from setup process.
 */
export interface SetupResult {
  success: boolean;
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  installed?: boolean;
  embedModelPulled: boolean;
  summarizationModelPulled: boolean;
  healthCheckPassed: boolean;
  error?: string;
  instructions?: string;
}

/**
 * Check if Ollama is installed on the system.
 */
export async function checkOllamaInstalled(): Promise<boolean> {
  try {
    await execAsync('which ollama');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Ollama service is running by calling its API.
 */
export async function checkOllamaRunning(): Promise<boolean> {
  try {
    await ollama.list();
    return true;
  } catch {
    return false;
  }
}

/**
 * Pull a model from Ollama registry.
 */
export async function pullModel(
  model: string,
  onProgress?: (status: string, completed?: number, total?: number) => void
): Promise<void> {
  const stream = await ollama.pull({
    model,
    stream: true,
  });

  for await (const chunk of stream) {
    if (onProgress) {
      onProgress(
        chunk.status,
        'completed' in chunk ? chunk.completed : undefined,
        'total' in chunk ? chunk.total : undefined
      );
    }
  }
}

/**
 * Perform health check to verify Ollama and models are available.
 */
export async function performHealthCheck(
  embedModel: string,
  summarizationModel?: string
): Promise<HealthCheckResult> {
  try {
    const response = await ollama.list();
    const modelNames = response.models.map((m) => m.name);

    const embedModelAvailable = modelNames.some(
      (name) => name === embedModel || name.startsWith(`${embedModel}:`)
    );

    const summarizationModelAvailable = summarizationModel
      ? modelNames.some(
          (name) => name === summarizationModel || name.startsWith(`${summarizationModel}:`)
        )
      : undefined;

    const success =
      embedModelAvailable &&
      (summarizationModel ? summarizationModelAvailable === true : true);

    return {
      success,
      ollamaRunning: true,
      embedModelAvailable,
      summarizationModelAvailable,
    };
  } catch (error) {
    return {
      success: false,
      ollamaRunning: false,
      embedModelAvailable: false,
      summarizationModelAvailable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get installation instructions for the current platform.
 */
export function getInstallInstructions(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      return `Ollama is not installed. Install it with:

  brew install ollama

Or download from: https://ollama.com

After installation, start Ollama with:
  ollama serve`;

    case 'linux':
      return `Ollama is not installed. Install it with:

  curl -fsSL https://ollama.com/install.sh | sh

After installation, start Ollama with:
  ollama serve`;

    case 'win32':
      return `Ollama is not installed. Download and install for Windows from:

  https://ollama.com/download

After installation, Ollama should start automatically.`;

    default:
      return `Ollama is not installed. Please visit https://ollama.com for installation instructions.`;
  }
}

/**
 * Attempt to install Ollama automatically (macOS and Linux only).
 */
export async function installOllama(
  platform: NodeJS.Platform
): Promise<InstallResult> {
  try {
    switch (platform) {
      case 'darwin': {
        // Check if brew is available
        try {
          await execAsync('brew --version');
        } catch {
          return {
            success: false,
            error: 'Homebrew not found. Please install Homebrew first: https://brew.sh',
            instructions: getInstallInstructions(platform),
          };
        }

        // Install with brew
        await execAsync('brew install ollama');
        return {
          success: true,
          method: 'brew',
        };
      }

      case 'linux': {
        // Use the official install script
        await execAsync('curl -fsSL https://ollama.com/install.sh | sh');
        return {
          success: true,
          method: 'script',
        };
      }

      case 'win32':
        return {
          success: false,
          error: 'Windows auto-install not supported',
          instructions: getInstallInstructions(platform),
        };

      default:
        return {
          success: false,
          error: `Unsupported platform: ${platform}`,
          instructions: getInstallInstructions(platform),
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      instructions: getInstallInstructions(platform),
    };
  }
}
