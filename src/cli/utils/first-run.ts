/**
 * First-run check utility for lgrep.
 * Shows a helpful message on first run if Ollama is not available.
 */

import { checkOllamaInstalled, checkOllamaRunning } from '../../core/ollama-setup.js';
import { hasShownSetupPrompt, markSetupPromptShown } from '../../storage/config.js';

/**
 * Check if Ollama is available and show a first-run prompt if not.
 * This is called once per installation to help users get started.
 *
 * @returns true if Ollama is available, false if not
 */
export async function checkFirstRun(): Promise<boolean> {
  // Skip during tests, CI, or if explicitly disabled
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST ||
    process.env.CI ||
    process.env.LGREP_SKIP_FIRST_RUN ||
    process.env.LGREP_HOME // Tests typically set this
  ) {
    return true;
  }

  // Skip if we've already shown the prompt
  if (hasShownSetupPrompt()) {
    return true;
  }

  try {
    // Use a timeout to prevent blocking the CLI
    const timeoutPromise = new Promise<{ installed: boolean; running: boolean } | 'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 2000); // 2 second timeout
    });

    const checkPromise = (async () => {
      const installed = await checkOllamaInstalled();
      const running = installed ? await checkOllamaRunning() : false;
      return { installed, running };
    })();

    const result = await Promise.race([checkPromise, timeoutPromise]);

    // If we timed out, skip the check silently
    if (result === 'timeout') {
      return true;
    }

    const { installed, running } = result;

    // If Ollama is ready, mark as shown and continue
    if (installed && running) {
      markSetupPromptShown();
      return true;
    }

    // Show first-run message
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│                    Welcome to lgrep!                        │');
    console.log('├─────────────────────────────────────────────────────────────┤');

    if (!installed) {
      console.log('│  Ollama is not installed.                                   │');
      console.log('│                                                             │');
      console.log('│  lgrep uses Ollama for local embeddings and AI features.   │');
      console.log('│  Without it, semantic search will not work.                │');
    } else if (!running) {
      console.log('│  Ollama is installed but not running.                      │');
      console.log('│                                                             │');
      console.log('│  Start Ollama with: ollama serve                           │');
    }

    console.log('│                                                             │');
    console.log('│  Quick setup:                                               │');
    console.log('│    npx lgrep setup                                          │');
    console.log('│                                                             │');
    console.log('│  This will install Ollama and download required models.     │');
    console.log('└─────────────────────────────────────────────────────────────┘\n');

    // Mark as shown so we don't spam the user
    markSetupPromptShown();
    return false;
  } catch {
    // If check fails, don't block the user
    return true;
  }
}

/**
 * Quick check if Ollama is available (for commands that need it).
 * Does not show any prompts.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const installed = await checkOllamaInstalled();
    if (!installed) return false;
    return await checkOllamaRunning();
  } catch {
    return false;
  }
}
