import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkOllamaInstalled,
  checkOllamaRunning,
  pullModel,
  performHealthCheck,
  installOllama,
  getInstallInstructions,
  type SetupResult,
} from './ollama-setup.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Mock child_process
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

// Mock ollama module
vi.mock('ollama', () => ({
  default: {
    list: vi.fn(),
    pull: vi.fn(),
  },
}));

describe('ollama-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkOllamaInstalled', () => {
    it('should return true when ollama is installed', async () => {
      vi.mocked(exec).mockImplementation(((
        _cmd: string,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(null, '/usr/local/bin/ollama', '');
      }) as typeof exec);

      const result = await checkOllamaInstalled();
      expect(result).toBe(true);
    });

    it('should return false when ollama is not installed', async () => {
      vi.mocked(exec).mockImplementation(((
        _cmd: string,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        const error = new Error('Command not found') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        callback(error, '', '');
      }) as typeof exec);

      const result = await checkOllamaInstalled();
      expect(result).toBe(false);
    });
  });

  describe('checkOllamaRunning', () => {
    it('should return true when Ollama API is accessible', async () => {
      const ollama = await import('ollama');
      vi.mocked(ollama.default.list).mockResolvedValue({
        models: [],
      });

      const result = await checkOllamaRunning();
      expect(result).toBe(true);
    });

    it('should return false when Ollama API is not accessible', async () => {
      const ollama = await import('ollama');
      vi.mocked(ollama.default.list).mockRejectedValue(new Error('Connection refused'));

      const result = await checkOllamaRunning();
      expect(result).toBe(false);
    });
  });

  describe('pullModel', () => {
    it('should pull a model successfully', async () => {
      const ollama = await import('ollama');
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { status: 'pulling manifest' };
          yield { status: 'downloading', completed: 50, total: 100 };
          yield { status: 'success' };
        },
      };

      vi.mocked(ollama.default.pull).mockResolvedValue(mockStream as never);

      const onProgress = vi.fn();
      await pullModel('test-model', onProgress);

      expect(ollama.default.pull).toHaveBeenCalledWith({
        model: 'test-model',
        stream: true,
      });
      expect(onProgress).toHaveBeenCalled();
    });

    it('should handle pull errors', async () => {
      const ollama = await import('ollama');
      vi.mocked(ollama.default.pull).mockRejectedValue(new Error('Network error'));

      await expect(pullModel('test-model')).rejects.toThrow('Network error');
    });
  });

  describe('performHealthCheck', () => {
    it('should return success when models are available', async () => {
      const ollama = await import('ollama');
      vi.mocked(ollama.default.list).mockResolvedValue({
        models: [
          { name: 'mxbai-embed-large:latest' } as never,
          { name: 'llama3.2:3b' } as never,
        ],
      });

      const result = await performHealthCheck('mxbai-embed-large', 'llama3.2:3b');

      expect(result.success).toBe(true);
      expect(result.embedModelAvailable).toBe(true);
      expect(result.summarizationModelAvailable).toBe(true);
    });

    it('should detect missing embedding model', async () => {
      const ollama = await import('ollama');
      vi.mocked(ollama.default.list).mockResolvedValue({
        models: [{ name: 'llama3.2:3b' } as never],
      });

      const result = await performHealthCheck('mxbai-embed-large', 'llama3.2:3b');

      expect(result.success).toBe(false);
      expect(result.embedModelAvailable).toBe(false);
      expect(result.summarizationModelAvailable).toBe(true);
    });

    it('should handle Ollama connection errors', async () => {
      const ollama = await import('ollama');
      vi.mocked(ollama.default.list).mockRejectedValue(new Error('Connection refused'));

      const result = await performHealthCheck('mxbai-embed-large');

      expect(result.success).toBe(false);
      expect(result.ollamaRunning).toBe(false);
    });
  });

  describe('getInstallInstructions', () => {
    it('should return macOS instructions', () => {
      const instructions = getInstallInstructions('darwin');

      expect(instructions).toContain('brew install ollama');
      expect(instructions).toContain('ollama.com');
    });

    it('should return Linux instructions', () => {
      const instructions = getInstallInstructions('linux');

      expect(instructions).toContain('curl -fsSL');
      expect(instructions).toContain('ollama.com/install.sh');
    });

    it('should return Windows instructions', () => {
      const instructions = getInstallInstructions('win32');

      expect(instructions).toContain('ollama.com/download');
      expect(instructions).toContain('Windows');
    });

    it('should handle unknown platforms', () => {
      const instructions = getInstallInstructions('freebsd' as never);

      expect(instructions).toContain('ollama.com');
    });
  });

  describe('installOllama', () => {
    it('should install on macOS using brew', async () => {
      vi.mocked(exec).mockImplementation(((
        cmd: string,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        if (cmd.includes('brew --version')) {
          callback(null, 'Homebrew 4.0.0', '');
        } else if (cmd.includes('brew install ollama')) {
          callback(null, 'Installation successful', '');
        }
      }) as typeof exec);

      const result = await installOllama('darwin');

      expect(result.success).toBe(true);
      expect(result.method).toBe('brew');
    });

    it('should fail when brew is not available on macOS', async () => {
      vi.mocked(exec).mockImplementation(((
        _cmd: string,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        const error = new Error('Command not found') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        callback(error, '', '');
      }) as typeof exec);

      const result = await installOllama('darwin');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Homebrew not found');
    });

    it('should install on Linux using curl script', async () => {
      vi.mocked(exec).mockImplementation(((
        _cmd: string,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(null, 'Installation successful', '');
      }) as typeof exec);

      const result = await installOllama('linux');

      expect(result.success).toBe(true);
      expect(result.method).toBe('script');
    });

    it('should not auto-install on Windows', async () => {
      const result = await installOllama('win32');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Windows');
      expect(result.instructions).toBeTruthy();
    });
  });
});
