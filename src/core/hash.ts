import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Generate a SHA-256 hash of string or buffer content.
 */
export function hashContent(content: string | Buffer): string {
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Generate a SHA-256 hash of a file's contents.
 */
export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return hashContent(content);
}

/**
 * Create a cache key from model name and content.
 * This is used for the embedding cache to avoid recomputing embeddings.
 */
export function createCacheKey(model: string, content: string): string {
  // Combine model and content to create a unique key
  const combined = `${model}:${content}`;
  return hashContent(combined);
}
