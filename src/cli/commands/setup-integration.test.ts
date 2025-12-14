import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runSetupCommand } from './setup.js';
import * as ollamaSetup from '../../core/ollama-setup.js';

// Mock the ollama-setup module for integration test
vi.mock('../../core/ollama-setup.js', () => ({
  checkOllamaInstalled: vi.fn(),
  checkOllamaRunning: vi.fn(),
  pullModel: vi.fn(),
  performHealthCheck: vi.fn(),
  installOllama: vi.fn(),
  getInstallInstructions: vi.fn(),
}));

describe('setup command integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete full setup workflow', async () => {
    // Mock a complete successful setup
    vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(true);
    vi.mocked(ollamaSetup.checkOllamaRunning).mockResolvedValue(true);

    let embedModelCalled = false;
    let summarizationModelCalled = false;

    vi.mocked(ollamaSetup.pullModel).mockImplementation(
      async (model: string, onProgress?: (status: string, completed?: number, total?: number) => void) => {
        if (model === 'mxbai-embed-large') {
          embedModelCalled = true;
          onProgress?.('downloading', 50, 100);
          onProgress?.('downloading', 100, 100);
        } else if (model === 'llama3.2:3b') {
          summarizationModelCalled = true;
          onProgress?.('downloading', 50, 100);
          onProgress?.('downloading', 100, 100);
        }
      }
    );

    vi.mocked(ollamaSetup.performHealthCheck).mockResolvedValue({
      success: true,
      ollamaRunning: true,
      embedModelAvailable: true,
      summarizationModelAvailable: true,
    });

    // Track progress calls
    const progressSteps: string[] = [];
    const result = await runSetupCommand({
      onProgress: (step: string) => {
        progressSteps.push(step);
      },
    });

    // Verify result
    expect(result.success).toBe(true);
    expect(result.ollamaInstalled).toBe(true);
    expect(result.ollamaRunning).toBe(true);
    expect(result.embedModelPulled).toBe(true);
    expect(result.summarizationModelPulled).toBe(true);
    expect(result.healthCheckPassed).toBe(true);

    // Verify models were pulled
    expect(embedModelCalled).toBe(true);
    expect(summarizationModelCalled).toBe(true);

    // Verify progress steps were called
    expect(progressSteps).toContain('check-install');
    expect(progressSteps).toContain('check-running');
    expect(progressSteps).toContain('pull-embed');
    expect(progressSteps).toContain('pull-summarization');
    expect(progressSteps).toContain('health-check');
  });

  it('should handle partial failure gracefully', async () => {
    vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(true);
    vi.mocked(ollamaSetup.checkOllamaRunning).mockResolvedValue(true);

    // Simulate embed model succeeds, summarization fails
    vi.mocked(ollamaSetup.pullModel).mockImplementation(async (model: string) => {
      if (model === 'mxbai-embed-large') {
        return;
      } else if (model === 'llama3.2:3b') {
        throw new Error('Network timeout');
      }
    });

    const result = await runSetupCommand({});

    expect(result.success).toBe(false);
    expect(result.embedModelPulled).toBe(true);
    expect(result.summarizationModelPulled).toBe(false);
    expect(result.error).toContain('Network timeout');
  });

  it('should skip summarization when requested', async () => {
    vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(true);
    vi.mocked(ollamaSetup.checkOllamaRunning).mockResolvedValue(true);
    vi.mocked(ollamaSetup.pullModel).mockResolvedValue(undefined);
    vi.mocked(ollamaSetup.performHealthCheck).mockResolvedValue({
      success: true,
      ollamaRunning: true,
      embedModelAvailable: true,
      summarizationModelAvailable: false,
    });

    const result = await runSetupCommand({ skipSummarization: true });

    expect(result.success).toBe(true);
    expect(result.embedModelPulled).toBe(true);
    expect(result.summarizationModelPulled).toBe(false);

    // Verify pullModel was only called once (for embed model)
    expect(ollamaSetup.pullModel).toHaveBeenCalledTimes(1);
    expect(ollamaSetup.pullModel).toHaveBeenCalledWith(
      'mxbai-embed-large',
      expect.any(Function)
    );
  });
});
