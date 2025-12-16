import { loadConfig } from '../../storage/config.js';
import {
  checkOllamaInstalled,
  checkOllamaRunning,
  pullModel,
  performHealthCheck,
  installOllama,
  getInstallInstructions,
  type SetupResult,
} from '../../core/ollama-setup.js';

/**
 * Options for setup command.
 */
export interface SetupOptions {
  skipSummarization?: boolean;
  autoInstall?: boolean;
  json?: boolean;
  onProgress?: (step: string, status?: string) => void;
}

/**
 * Run the setup command.
 */
export async function runSetupCommand(
  options: SetupOptions = {}
): Promise<SetupResult> {
  const { skipSummarization = false, autoInstall = true, onProgress } = options;

  const result: SetupResult = {
    success: false,
    ollamaInstalled: false,
    ollamaRunning: false,
    embedModelPulled: false,
    summarizationModelPulled: false,
    healthCheckPassed: false,
  };

  try {
    // Load config to get model names
    const config = await loadConfig();
    const embedModel = config.model;

    // For setup, resolve 'auto' to the default Ollama model since we're setting up local
    let summarizationModel: string | undefined;
    if (!skipSummarization) {
      if (config.summarizationModel === 'auto' || config.summarizationModel.startsWith('ollama:')) {
        // Use the Ollama model for local setup
        summarizationModel = config.summarizationModel === 'auto'
          ? 'llama3.2:3b'
          : config.summarizationModel.replace('ollama:', '');
      } else {
        // Non-Ollama provider configured, skip pulling summarization model
        summarizationModel = undefined;
      }
    }

    // Step 1: Check if Ollama is installed
    onProgress?.('check-install', 'Checking Ollama installation...');
    const installed = await checkOllamaInstalled();
    result.ollamaInstalled = installed;

    if (!installed) {
      if (!autoInstall) {
        result.error = 'Ollama is not installed';
        result.instructions = getInstallInstructions(process.platform);
        return result;
      }

      // Attempt to install
      onProgress?.('install', 'Installing Ollama...');
      const installResult = await installOllama(process.platform);

      if (!installResult.success) {
        result.error = installResult.error;
        result.instructions = installResult.instructions;
        return result;
      }

      result.installed = true;
      result.ollamaInstalled = true;
    }

    // Step 2: Check if Ollama is running
    onProgress?.('check-running', 'Checking if Ollama is running...');
    const running = await checkOllamaRunning();
    result.ollamaRunning = running;

    if (!running) {
      result.error = 'Ollama is not running. Start it with: ollama serve';
      return result;
    }

    // Step 3: Pull embedding model
    onProgress?.('pull-embed', `Pulling ${embedModel}...`);
    try {
      await pullModel(embedModel, (status, completed, total) => {
        if (completed !== undefined && total !== undefined) {
          const percent = Math.round((completed / total) * 100);
          onProgress?.('pull-embed', `${status} ${percent}%`);
        } else {
          onProgress?.('pull-embed', status);
        }
      });
      result.embedModelPulled = true;
    } catch (error) {
      result.error = `Failed to pull ${embedModel}: ${error instanceof Error ? error.message : String(error)}`;
      return result;
    }

    // Step 4: Pull summarization model (if not skipped)
    if (summarizationModel) {
      onProgress?.('pull-summarization', `Pulling ${summarizationModel}...`);
      try {
        await pullModel(summarizationModel, (status, completed, total) => {
          if (completed !== undefined && total !== undefined) {
            const percent = Math.round((completed / total) * 100);
            onProgress?.('pull-summarization', `${status} ${percent}%`);
          } else {
            onProgress?.('pull-summarization', status);
          }
        });
        result.summarizationModelPulled = true;
      } catch (error) {
        result.error = `Failed to pull ${summarizationModel}: ${error instanceof Error ? error.message : String(error)}`;
        return result;
      }
    }

    // Step 5: Health check
    onProgress?.('health-check', 'Running health check...');
    const healthCheck = await performHealthCheck(embedModel, summarizationModel);

    result.healthCheckPassed = healthCheck.success;

    if (!healthCheck.success) {
      result.error = healthCheck.error || 'Health check failed';
      return result;
    }

    // Success!
    result.success = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}
