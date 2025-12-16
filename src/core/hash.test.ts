import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  hashContent,
  hashFile,
  createCacheKey,
} from './hash.js';

describe('hashing utilities', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lgrep-hash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('hashContent', () => {
    it('should generate a SHA-256 hash for string content', () => {
      const content = 'Hello, World!';
      const hash = hashContent(content);

      // SHA-256 produces 64 hex characters
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    it('should generate consistent hashes for the same content', () => {
      const content = 'test content';
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different content', () => {
      const hash1 = hashContent('content 1');
      const hash2 = hashContent('content 2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = hashContent('');

      // Empty string should still produce a valid hash
      expect(hash).toHaveLength(64);
      // Known SHA-256 of empty string
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should handle unicode content', () => {
      const content = '你好世界 🌍 مرحبا';
      const hash = hashContent(content);

      expect(hash).toHaveLength(64);
    });

    it('should handle Buffer input', () => {
      const content = Buffer.from('test content');
      const hash = hashContent(content);

      expect(hash).toHaveLength(64);
    });
  });

  describe('hashFile', () => {
    it('should hash file contents', async () => {
      const filePath = join(testDir, 'test.txt');
      await writeFile(filePath, 'file content');

      const hash = await hashFile(filePath);

      expect(hash).toHaveLength(64);
    });

    it('should produce consistent hashes for same file', async () => {
      const filePath = join(testDir, 'test.txt');
      await writeFile(filePath, 'file content');

      const hash1 = await hashFile(filePath);
      const hash2 = await hashFile(filePath);

      expect(hash1).toBe(hash2);
    });

    it('should produce same hash as hashContent for same content', async () => {
      const content = 'matching content';
      const filePath = join(testDir, 'test.txt');
      await writeFile(filePath, content);

      const fileHash = await hashFile(filePath);
      const contentHash = hashContent(content);

      expect(fileHash).toBe(contentHash);
    });

    it('should throw error for non-existent file', async () => {
      const filePath = join(testDir, 'nonexistent.txt');

      await expect(hashFile(filePath)).rejects.toThrow();
    });
  });

  describe('createCacheKey', () => {
    it('should create a cache key from model and content', () => {
      const key = createCacheKey('mxbai-embed-large', 'test content');

      expect(key).toHaveLength(64);
    });

    it('should produce different keys for different models', () => {
      const content = 'same content';
      const key1 = createCacheKey('model-a', content);
      const key2 = createCacheKey('model-b', content);

      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different content', () => {
      const model = 'mxbai-embed-large';
      const key1 = createCacheKey(model, 'content 1');
      const key2 = createCacheKey(model, 'content 2');

      expect(key1).not.toBe(key2);
    });

    it('should produce consistent keys', () => {
      const model = 'mxbai-embed-large';
      const content = 'test content';
      const key1 = createCacheKey(model, content);
      const key2 = createCacheKey(model, content);

      expect(key1).toBe(key2);
    });
  });
});
