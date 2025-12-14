import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runSetupCommand } from './setup.js';
import * as ollamaSetup from '../../core/ollama-setup.js';

// Mock the ollama-setup module
vi.mock('../../core/ollama-setup.js', () => ({
  checkOllamaInstalled: vi.fn(),
  checkOllamaRunning: vi.fn(),
  pullModel: vi.fn(),
  performHealthCheck: vi.fn(),
  installOllama: vi.fn(),
  getInstallInstructions: vi.fn(),
}));

describe('setup command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful setup', () => {
    it('should complete setup when Ollama is already installed and running', async () => {
      vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(true);
      vi.mocked(ollamaSetup.checkOllamaRunning).mockResolvedValue(true);
      vi.mocked(ollamaSetup.pullModel).mockResolvedValue(undefined);
      vi.mocked(ollamaSetup.performHealthCheck).mockResolvedValue({
        success: true,
        ollamaRunning: true,
        embedModelAvailable: true,
        summarizationModelAvailable: true,
      });

      const result = await runSetupCommand({});

      expect(result.success).toBe(true);
      expect(result.ollamaInstalled).toBe(true);
      expect(result.ollamaRunning).toBe(true);
      expect(result.embedModelPulled).toBe(true);
      expect(result.summarizationModelPulled).toBe(true);
      expect(result.healthCheckPassed).toBe(true);
    });

    it('should skip summarization model when flag is set', async () => {
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
      expect(result.summarizationModelPulled).toBe(false);
      expect(ollamaSetup.pullModel).toHaveBeenCalledTimes(1); // Only embed model
    });

    it('should install Ollama when not present', async () => {
      vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(false);
      vi.mocked(ollamaSetup.installOllama).mockResolvedValue({
        success: true,
        method: 'brew',
      });
      vi.mocked(ollamaSetup.checkOllamaRunning).mockResolvedValue(true);
      vi.mocked(ollamaSetup.pullModel).mockResolvedValue(undefined);
      vi.mocked(ollamaSetup.performHealthCheck).mockResolvedValue({
        success: true,
        ollamaRunning: true,
        embedModelAvailable: true,
        summarizationModelAvailable: true,
      });

      const result = await runSetupCommand({ autoInstall: true });

      expect(ollamaSetup.installOllama).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.installed).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should fail when Ollama is not installed and auto-install is disabled', async () => {
      vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(false);
      vi.mocked(ollamaSetup.getInstallInstructions).mockReturnValue(
        'Install instructions here'
      );

      const result = await runSetupCommand({ autoInstall: false });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not installed');
      expect(result.instructions).toBeTruthy();
    });

    it('should fail when Ollama is not running', async () => {
      vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(true);
      vi.mocked(ollamaSetup.checkOllamaRunning).mockResolvedValue(false);

      const result = await runSetupCommand({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not running');
    });

    it('should fail when model pull fails', async () => {
      vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(true);
      vi.mocked(ollamaSetup.checkOllamaRunning).mockResolvedValue(true);
      vi.mocked(ollamaSetup.pullModel).mockRejectedValue(
        new Error('Network error')
      );

      const result = await runSetupCommand({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should fail when health check fails', async () => {
      vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(true);
      vi.mocked(ollamaSetup.checkOllamaRunning).mockResolvedValue(true);
      vi.mocked(ollamaSetup.pullModel).mockResolvedValue(undefined);
      vi.mocked(ollamaSetup.performHealthCheck).mockResolvedValue({
        success: false,
        ollamaRunning: true,
        embedModelAvailable: false,
        summarizationModelAvailable: false,
        error: 'Models not available',
      });

      const result = await runSetupCommand({});

      expect(result.success).toBe(false);
      expect(result.healthCheckPassed).toBe(false);
    });
  });

  describe('JSON output', () => {
    it('should format output as JSON when requested', async () => {
      vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(true);
      vi.mocked(ollamaSetup.checkOllamaRunning).mockResolvedValue(true);
      vi.mocked(ollamaSetup.pullModel).mockResolvedValue(undefined);
      vi.mocked(ollamaSetup.performHealthCheck).mockResolvedValue({
        success: true,
        ollamaRunning: true,
        embedModelAvailable: true,
        summarizationModelAvailable: true,
      });

      const result = await runSetupCommand({ json: true });

      expect(result.success).toBe(true);
      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('ollamaInstalled');
      expect(result).toHaveProperty('ollamaRunning');
      expect(result).toHaveProperty('embedModelPulled');
    });
  });

  describe('progress reporting', () => {
    it('should report progress during model pull', async () => {
      vi.mocked(ollamaSetup.checkOllamaInstalled).mockResolvedValue(true);
      vi.mocked(ollamaSetup.checkOllamaRunning).mockResolvedValue(true);

      let progressCallback: ((status: string, completed?: number, total?: number) => void) | undefined;
      vi.mocked(ollamaSetup.pullModel).mockImplementation(
        async (_model: string, onProgress?: (status: string, completed?: number, total?: number) => void) => {
          progressCallback = onProgress;
          if (onProgress) {
            onProgress('downloading', 50, 100);
            onProgress('downloading', 100, 100);
          }
        }
      );

      vi.mocked(ollamaSetup.performHealthCheck).mockResolvedValue({
        success: true,
        ollamaRunning: true,
        embedModelAvailable: true,
        summarizationModelAvailable: true,
      });

      const onProgress = vi.fn();
      const result = await runSetupCommand({ onProgress });

      expect(result.success).toBe(true);
      expect(progressCallback).toBeDefined();
    });
  });
});
