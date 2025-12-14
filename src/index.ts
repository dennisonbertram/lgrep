// Core exports
export { chunkText, estimateTokens, type Chunk, type ChunkOptions } from './core/chunker.js';
export { createEmbeddingClient, type EmbeddingClient, type EmbeddingResult, type HealthCheckResult } from './core/embeddings.js';
export { hashContent, hashFile, createCacheKey } from './core/hash.js';
export { walkFiles, shouldExclude, isBinaryFile, DEFAULT_EXCLUDES, DEFAULT_SECRET_EXCLUDES, type WalkResult, type WalkOptions } from './core/walker.js';

// Storage exports
export { loadConfig, saveConfig, getConfigValue, setConfigValue, DEFAULT_CONFIG, type MgrepConfig } from './storage/config.js';
export {
  openDatabase,
  createIndex,
  getIndex,
  deleteIndex,
  listIndexes,
  addChunks,
  searchChunks,
  getChunkCount,
  updateIndexStatus,
  type IndexDatabase,
  type IndexHandle,
  type IndexMetadata,
  type CreateIndexOptions,
  type DocumentChunk,
  type SearchOptions,
  type SearchResult,
} from './storage/lance.js';
export {
  openEmbeddingCache,
  getEmbedding,
  setEmbedding,
  getCacheStats,
  clearCache,
  type EmbeddingCache,
  type CacheStats,
} from './storage/cache.js';

// CLI utilities
export { getMgrepHome, getDbPath, getConfigPath, getCachePath, getIndexPath, getIndexMetaPath } from './cli/utils/paths.js';
