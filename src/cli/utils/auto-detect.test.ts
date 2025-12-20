import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { detectIndexForDirectory } from './auto-detect.js';
import * as lance from '../../storage/lance.js';

// Mock the lance module
vi.mock('../../storage/lance.js', () => ({
  openDatabase: vi.fn(),
  listIndexes: vi.fn(),
}));

// Mock paths module
vi.mock('./paths.js', () => ({
  getDbPath: vi.fn(() => '/mock/db/path'),
}));

describe('detectIndexForDirectory', () => {
  const mockDb = {
    path: '/mock/db/path',
    connection: {} as any,
    close: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(lance.openDatabase).mockResolvedValue(mockDb);
    vi.mocked(lance.listIndexes).mockResolvedValue([]);
    mockDb.close.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no indexes exist', async () => {
    vi.mocked(lance.listIndexes).mockResolvedValue([]);

    const result = await detectIndexForDirectory('/some/path');

    expect(result).toBeNull();
  });

  it('returns index name when directory matches exactly', async () => {
    const mockIndexes = [
      {
        name: 'my-project',
        metadata: {
          rootPath: '/projects/my-project',
          status: 'ready' as const,
          schemaVersion: 1,
          model: 'test',
          modelDimensions: 1024,
          createdAt: '',
          updatedAt: '',
          documentCount: 0,
          chunkCount: 0,
          generationId: 1,
          name: 'my-project',
        },
        table: null,
      },
    ];
    vi.mocked(lance.listIndexes).mockResolvedValue(mockIndexes);

    const result = await detectIndexForDirectory('/projects/my-project');

    expect(result).toBe('my-project');
  });

  it('returns index name when inside indexed directory (subdirectory)', async () => {
    const mockIndexes = [
      {
        name: 'my-project',
        metadata: {
          rootPath: '/projects/my-project',
          status: 'ready' as const,
          schemaVersion: 1,
          model: 'test',
          modelDimensions: 1024,
          createdAt: '',
          updatedAt: '',
          documentCount: 0,
          chunkCount: 0,
          generationId: 1,
          name: 'my-project',
        },
        table: null,
      },
    ];
    vi.mocked(lance.listIndexes).mockResolvedValue(mockIndexes);

    const result = await detectIndexForDirectory('/projects/my-project/src/components');

    expect(result).toBe('my-project');
  });

  it('returns the most specific (deepest) matching index', async () => {
    const mockIndexes = [
      {
        name: 'projects',
        metadata: {
          rootPath: '/projects',
          status: 'ready' as const,
          schemaVersion: 1,
          model: 'test',
          modelDimensions: 1024,
          createdAt: '',
          updatedAt: '',
          documentCount: 0,
          chunkCount: 0,
          generationId: 1,
          name: 'projects',
        },
        table: null,
      },
      {
        name: 'my-project',
        metadata: {
          rootPath: '/projects/my-project',
          status: 'ready' as const,
          schemaVersion: 1,
          model: 'test',
          modelDimensions: 1024,
          createdAt: '',
          updatedAt: '',
          documentCount: 0,
          chunkCount: 0,
          generationId: 1,
          name: 'my-project',
        },
        table: null,
      },
    ];
    vi.mocked(lance.listIndexes).mockResolvedValue(mockIndexes);

    const result = await detectIndexForDirectory('/projects/my-project/src');

    // Should return 'my-project' because it's the more specific match
    expect(result).toBe('my-project');
  });

  it('returns null when directory is not inside any indexed path', async () => {
    const mockIndexes = [
      {
        name: 'my-project',
        metadata: {
          rootPath: '/projects/my-project',
          status: 'ready' as const,
          schemaVersion: 1,
          model: 'test',
          modelDimensions: 1024,
          createdAt: '',
          updatedAt: '',
          documentCount: 0,
          chunkCount: 0,
          generationId: 1,
          name: 'my-project',
        },
        table: null,
      },
    ];
    vi.mocked(lance.listIndexes).mockResolvedValue(mockIndexes);

    const result = await detectIndexForDirectory('/other/path');

    expect(result).toBeNull();
  });

  it('handles paths with trailing slashes', async () => {
    const mockIndexes = [
      {
        name: 'my-project',
        metadata: {
          rootPath: '/projects/my-project/',
          status: 'ready' as const,
          schemaVersion: 1,
          model: 'test',
          modelDimensions: 1024,
          createdAt: '',
          updatedAt: '',
          documentCount: 0,
          chunkCount: 0,
          generationId: 1,
          name: 'my-project',
        },
        table: null,
      },
    ];
    vi.mocked(lance.listIndexes).mockResolvedValue(mockIndexes);

    const result = await detectIndexForDirectory('/projects/my-project/src/');

    expect(result).toBe('my-project');
  });

  it('uses current working directory when no directory provided', async () => {
    const mockIndexes = [
      {
        name: 'cwd-project',
        metadata: {
          rootPath: process.cwd(),
          status: 'ready' as const,
          schemaVersion: 1,
          model: 'test',
          modelDimensions: 1024,
          createdAt: '',
          updatedAt: '',
          documentCount: 0,
          chunkCount: 0,
          generationId: 1,
          name: 'cwd-project',
        },
        table: null,
      },
    ];
    vi.mocked(lance.listIndexes).mockResolvedValue(mockIndexes);

    const result = await detectIndexForDirectory();

    expect(result).toBe('cwd-project');
  });

  it('skips indexes with failed status', async () => {
    const mockIndexes = [
      {
        name: 'failed-project',
        metadata: {
          rootPath: '/projects/my-project',
          status: 'failed' as const,
          schemaVersion: 1,
          model: 'test',
          modelDimensions: 1024,
          createdAt: '',
          updatedAt: '',
          documentCount: 0,
          chunkCount: 0,
          generationId: 1,
          name: 'failed-project',
        },
        table: null,
      },
      {
        name: 'working-project',
        metadata: {
          rootPath: '/projects/my-project',
          status: 'ready' as const,
          schemaVersion: 1,
          model: 'test',
          modelDimensions: 1024,
          createdAt: '',
          updatedAt: '',
          documentCount: 0,
          chunkCount: 0,
          generationId: 1,
          name: 'working-project',
        },
        table: null,
      },
    ];
    vi.mocked(lance.listIndexes).mockResolvedValue(mockIndexes);

    const result = await detectIndexForDirectory('/projects/my-project');

    expect(result).toBe('working-project');
  });

  it('closes database connection after use', async () => {
    vi.mocked(lance.listIndexes).mockResolvedValue([]);

    await detectIndexForDirectory('/some/path');

    expect(mockDb.close).toHaveBeenCalledTimes(1);
  });

  it('closes database connection even on error', async () => {
    vi.mocked(lance.listIndexes).mockRejectedValue(new Error('DB error'));

    await expect(detectIndexForDirectory('/some/path')).rejects.toThrow('DB error');

    expect(mockDb.close).toHaveBeenCalledTimes(1);
  });
});
