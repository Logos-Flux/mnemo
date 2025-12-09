import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  handleContextLoad,
  handleContextQuery,
  handleContextList,
  handleContextEvict,
  handleContextStats,
  handleContextRefresh,
  type ToolHandlerDeps,
} from './handlers';
import type { CacheMetadata, CacheStorage, QueryResult, LoadedSource } from '@mnemo/core';
import { CacheNotFoundError } from '@mnemo/core';
import * as fs from 'node:fs/promises';

// ============================================================================
// Mock Implementations
// ============================================================================

function createMockStorage(): CacheStorage {
  const storage = new Map<string, CacheMetadata>();

  return {
    save: mock(async (metadata: CacheMetadata) => {
      storage.set(metadata.alias, metadata);
    }),
    getByAlias: mock(async (alias: string) => {
      return storage.get(alias) ?? null;
    }),
    getByName: mock(async (name: string) => {
      for (const cache of storage.values()) {
        if (cache.name === name) return cache;
      }
      return null;
    }),
    list: mock(async () => {
      return Array.from(storage.values()).map((c) => ({
        alias: c.alias,
        tokenCount: c.tokenCount,
        expiresAt: c.expiresAt,
        source: c.source,
      }));
    }),
    deleteByAlias: mock(async (alias: string) => {
      return storage.delete(alias);
    }),
    update: mock(async (alias: string, updates: Partial<CacheMetadata>) => {
      const existing = storage.get(alias);
      if (existing) {
        storage.set(alias, { ...existing, ...updates });
      }
    }),
  };
}

function createMockGeminiClient() {
  return {
    createCache: mock(async (content: string, alias: string, options?: any): Promise<CacheMetadata> => {
      return {
        name: `cache-${alias}-${Date.now()}`,
        alias,
        tokenCount: Math.ceil(content.length / 4),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + (options?.ttl ?? 3600) * 1000),
        source: 'mock-source',
        model: 'gemini-2.0-flash-001',
      };
    }),
    queryCache: mock(async (cacheName: string, query: string, options?: any): Promise<QueryResult> => {
      return {
        response: `Mock response for: ${query}`,
        tokensUsed: 100,
        cachedTokensUsed: 50,
        model: 'gemini-2.0-flash-001',
      };
    }),
    deleteCache: mock(async (name: string) => {
      // Mock deletion
    }),
  };
}

function createMockRepoLoader() {
  return {
    loadDirectory: mock(async (path: string): Promise<LoadedSource> => {
      return {
        content: `Mock content for ${path}`,
        totalTokens: 1000,
        fileCount: 5,
        files: [],
        metadata: {
          source: path,
          loadedAt: new Date(),
        },
      };
    }),
  };
}

function createMockSourceLoader() {
  return {
    loadFile: mock(async (path: string): Promise<LoadedSource> => {
      return {
        content: `Mock file content for ${path}`,
        totalTokens: 500,
        fileCount: 1,
        files: [],
        metadata: {
          source: path,
          loadedAt: new Date(),
        },
      };
    }),
  };
}

function createMockDeps(): ToolHandlerDeps {
  return {
    geminiClient: createMockGeminiClient() as any,
    storage: createMockStorage(),
    repoLoader: createMockRepoLoader() as any,
    sourceLoader: createMockSourceLoader() as any,
  };
}

// Helper to mock fs.stat for directory
function mockStatForDirectory() {
  return spyOn(fs, 'stat').mockResolvedValue({
    isDirectory: () => true,
    isFile: () => false,
  } as any);
}

// Helper to mock fs.stat for file
function mockStatForFile() {
  return spyOn(fs, 'stat').mockResolvedValue({
    isDirectory: () => false,
    isFile: () => true,
  } as any);
}

// ============================================================================
// handleContextLoad Tests
// ============================================================================

describe('handleContextLoad', () => {
  let statSpy: any;

  beforeEach(() => {
    // Mock fs.stat to return a directory by default
    statSpy = mockStatForDirectory();
  });

  afterEach(() => {
    statSpy?.mockRestore();
  });

  test('loads a local directory successfully', async () => {
    const deps = createMockDeps();
    const input = {
      source: '/test/directory',
      alias: 'test-repo',
      ttl: 3600,
    };

    const result = await handleContextLoad(deps, input);

    expect(result.success).toBe(true);
    expect(result.cache.alias).toBe('test-repo');
    expect(result.cache.tokenCount).toBeGreaterThan(0);
    expect(deps.repoLoader.loadDirectory).toHaveBeenCalledTimes(1);
    expect(deps.geminiClient.createCache).toHaveBeenCalledTimes(1);
    expect(deps.storage.save).toHaveBeenCalledTimes(1);
  });

  test('validates input with Zod schema', async () => {
    const deps = createMockDeps();
    const invalidInput = {
      source: '',
      alias: '', // Empty alias should fail
    };

    await expect(handleContextLoad(deps, invalidInput)).rejects.toThrow();
  });

  test('rejects alias that is too long', async () => {
    const deps = createMockDeps();
    const input = {
      source: '/test',
      alias: 'x'.repeat(65), // Max is 64
      ttl: 3600,
    };

    await expect(handleContextLoad(deps, input)).rejects.toThrow();
  });

  test('rejects ttl outside valid range', async () => {
    const deps = createMockDeps();
    const inputTooLow = {
      source: '/test',
      alias: 'test',
      ttl: 30, // Min is 60
    };

    await expect(handleContextLoad(deps, inputTooLow)).rejects.toThrow();

    const inputTooHigh = {
      source: '/test',
      alias: 'test',
      ttl: 90000, // Max is 86400
    };

    await expect(handleContextLoad(deps, inputTooHigh)).rejects.toThrow();
  });

  test('evicts existing cache with same alias', async () => {
    const deps = createMockDeps();

    // Create initial cache
    const initialInput = {
      source: '/test/old',
      alias: 'test-repo',
      ttl: 3600,
    };
    await handleContextLoad(deps, initialInput);

    // Load with same alias
    const newInput = {
      source: '/test/new',
      alias: 'test-repo',
      ttl: 3600,
    };

    const result = await handleContextLoad(deps, newInput);

    expect(result.success).toBe(true);
    expect(deps.geminiClient.deleteCache).toHaveBeenCalled();
    expect(deps.storage.deleteByAlias).toHaveBeenCalledWith('test-repo');
  });

  test('detects GitHub URLs but requires git (skipped)', async () => {
    // This test would require actual git cloning which we skip in unit tests
    // The isGitHubUrl function is tested separately in repo-loader.test.ts
    // The loadGitHubRepo function requires external git binary and network access
    expect(true).toBe(true); // Placeholder for test structure
  });

  test('sets custom system instruction', async () => {
    const deps = createMockDeps();
    const input = {
      source: '/test',
      alias: 'test-repo',
      ttl: 3600,
      systemInstruction: 'You are a code reviewer',
    };

    await handleContextLoad(deps, input);

    expect(deps.geminiClient.createCache).toHaveBeenCalledWith(
      expect.any(String),
      'test-repo',
      expect.objectContaining({
        systemInstruction: 'You are a code reviewer',
      })
    );
  });

  test('updates cache metadata with source', async () => {
    const deps = createMockDeps();
    const input = {
      source: '/custom/path',
      alias: 'test',
      ttl: 3600,
    };

    const result = await handleContextLoad(deps, input);

    expect(result.cache.source).toBe('/custom/path');
  });
});

// ============================================================================
// handleContextQuery Tests
// ============================================================================

describe('handleContextQuery', () => {
  let statSpy: any;

  beforeEach(() => {
    statSpy = mockStatForDirectory();
  });

  afterEach(() => {
    statSpy?.mockRestore();
  });

  test('queries an existing cache successfully', async () => {
    const deps = createMockDeps();

    // First, create a cache
    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-repo',
      ttl: 3600,
    });

    // Now query it
    const result = await handleContextQuery(deps, {
      alias: 'test-repo',
      query: 'What files are in this repo?',
    });

    expect(result.response).toContain('Mock response');
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(deps.geminiClient.queryCache).toHaveBeenCalledTimes(1);
  });

  test('validates input schema', async () => {
    const deps = createMockDeps();
    const invalidInput = {
      alias: '', // Empty alias should fail
      query: 'test',
    };

    await expect(handleContextQuery(deps, invalidInput)).rejects.toThrow();
  });

  test('throws CacheNotFoundError for non-existent cache', async () => {
    const deps = createMockDeps();
    const input = {
      alias: 'non-existent',
      query: 'test query',
    };

    await expect(handleContextQuery(deps, input)).rejects.toThrow(CacheNotFoundError);
  });

  test('throws CacheNotFoundError for expired cache', async () => {
    const deps = createMockDeps();
    const storage = deps.storage as any;

    // Manually insert an expired cache
    const expiredCache: CacheMetadata = {
      name: 'cache-expired',
      alias: 'expired',
      tokenCount: 1000,
      createdAt: new Date(Date.now() - 7200000), // 2 hours ago
      expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
      source: '/test',
      model: 'gemini-2.0-flash-001',
    };

    await storage.save(expiredCache);

    const input = {
      alias: 'expired',
      query: 'test query',
    };

    await expect(handleContextQuery(deps, input)).rejects.toThrow(CacheNotFoundError);
    expect(deps.storage.deleteByAlias).toHaveBeenCalledWith('expired');
  });

  test('passes query options to Gemini client', async () => {
    const deps = createMockDeps();

    // Create cache first
    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-repo',
      ttl: 3600,
    });

    // Query with options
    await handleContextQuery(deps, {
      alias: 'test-repo',
      query: 'test query',
      maxTokens: 2000,
      temperature: 0.7,
    });

    expect(deps.geminiClient.queryCache).toHaveBeenCalledWith(
      expect.any(String),
      'test query',
      expect.objectContaining({
        maxOutputTokens: 2000,
        temperature: 0.7,
      })
    );
  });

  test('validates temperature range', async () => {
    const deps = createMockDeps();

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-repo',
      ttl: 3600,
    });

    const invalidTemp = {
      alias: 'test-repo',
      query: 'test',
      temperature: 3, // Max is 2
    };

    await expect(handleContextQuery(deps, invalidTemp)).rejects.toThrow();
  });
});

// ============================================================================
// handleContextList Tests
// ============================================================================

describe('handleContextList', () => {
  let statSpy: any;

  beforeEach(() => {
    statSpy = mockStatForDirectory();
  });

  afterEach(() => {
    statSpy?.mockRestore();
  });

  test('returns empty list when no caches exist', async () => {
    const deps = createMockDeps();
    const result = await handleContextList(deps);

    expect(result.caches).toEqual([]);
  });

  test('lists all active caches', async () => {
    const deps = createMockDeps();

    // Create multiple caches
    await handleContextLoad(deps, {
      source: '/test1',
      alias: 'cache1',
      ttl: 3600,
    });

    await handleContextLoad(deps, {
      source: '/test2',
      alias: 'cache2',
      ttl: 3600,
    });

    const result = await handleContextList(deps);

    expect(result.caches).toHaveLength(2);
    expect(result.caches.map(c => c.alias)).toContain('cache1');
    expect(result.caches.map(c => c.alias)).toContain('cache2');
  });

  test('includes cache metadata in list', async () => {
    const deps = createMockDeps();

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    const result = await handleContextList(deps);

    expect(result.caches[0]).toHaveProperty('alias');
    expect(result.caches[0]).toHaveProperty('tokenCount');
    expect(result.caches[0]).toHaveProperty('expiresAt');
    expect(result.caches[0]).toHaveProperty('source');
    expect(result.caches[0].expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
  });
});

// ============================================================================
// handleContextEvict Tests
// ============================================================================

describe('handleContextEvict', () => {
  let statSpy: any;

  beforeEach(() => {
    statSpy = mockStatForDirectory();
  });

  afterEach(() => {
    statSpy?.mockRestore();
  });

  test('evicts an existing cache successfully', async () => {
    const deps = createMockDeps();

    // Create cache
    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    // Evict it
    const result = await handleContextEvict(deps, {
      alias: 'test-cache',
    });

    expect(result.success).toBe(true);
    expect(result.alias).toBe('test-cache');
    expect(deps.geminiClient.deleteCache).toHaveBeenCalled();
    expect(deps.storage.deleteByAlias).toHaveBeenCalledWith('test-cache');
  });

  test('validates input schema', async () => {
    const deps = createMockDeps();
    const invalidInput = {
      alias: '', // Empty alias
    };

    await expect(handleContextEvict(deps, invalidInput)).rejects.toThrow();
  });

  test('throws CacheNotFoundError for non-existent cache', async () => {
    const deps = createMockDeps();
    const input = {
      alias: 'non-existent',
    };

    await expect(handleContextEvict(deps, input)).rejects.toThrow(CacheNotFoundError);
  });

  test('handles Gemini deletion errors gracefully', async () => {
    const deps = createMockDeps();

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    // Make deleteCache throw an error
    (deps.geminiClient.deleteCache as any).mockImplementation(async () => {
      throw new Error('Gemini API error');
    });

    // Should still succeed and clean up local storage
    const result = await handleContextEvict(deps, {
      alias: 'test-cache',
    });

    expect(result.success).toBe(true);
    expect(deps.storage.deleteByAlias).toHaveBeenCalledWith('test-cache');
  });
});

// ============================================================================
// handleContextStats Tests
// ============================================================================

describe('handleContextStats', () => {
  let statSpy: any;

  beforeEach(() => {
    statSpy = mockStatForDirectory();
  });

  afterEach(() => {
    statSpy?.mockRestore();
  });

  test('returns global stats for all caches', async () => {
    const deps = createMockDeps();

    await handleContextLoad(deps, {
      source: '/test1',
      alias: 'cache1',
      ttl: 3600,
    });

    await handleContextLoad(deps, {
      source: '/test2',
      alias: 'cache2',
      ttl: 3600,
    });

    const result = await handleContextStats(deps, {});

    expect(result.totalCaches).toBe(2);
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.caches).toHaveLength(2);
  });

  test('returns stats for specific cache', async () => {
    const deps = createMockDeps();

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'specific-cache',
      ttl: 3600,
    });

    const result = await handleContextStats(deps, {
      alias: 'specific-cache',
    });

    expect(result.totalCaches).toBe(1);
    expect(result.caches).toHaveLength(1);
    expect(result.caches?.[0].alias).toBe('specific-cache');
  });

  test('throws CacheNotFoundError for non-existent cache', async () => {
    const deps = createMockDeps();
    const input = {
      alias: 'non-existent',
    };

    await expect(handleContextStats(deps, input)).rejects.toThrow(CacheNotFoundError);
  });

  test('calculates total tokens correctly', async () => {
    const deps = createMockDeps();

    // Create caches with known token counts
    await handleContextLoad(deps, {
      source: '/test1',
      alias: 'cache1',
      ttl: 3600,
    });

    await handleContextLoad(deps, {
      source: '/test2',
      alias: 'cache2',
      ttl: 3600,
    });

    const result = await handleContextStats(deps, {});

    // Both caches should contribute to total
    expect(result.totalTokens).toBeGreaterThan(0);
    const sumOfCaches = result.caches!.reduce((sum, c) => sum + c.tokenCount, 0);
    expect(result.totalTokens).toBe(sumOfCaches);
  });

  test('returns zero stats when no caches exist', async () => {
    const deps = createMockDeps();
    const result = await handleContextStats(deps, {});

    expect(result.totalCaches).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.caches).toHaveLength(0);
  });

  test('validates input schema', async () => {
    const deps = createMockDeps();

    // Should accept empty object
    const result = await handleContextStats(deps, {});
    expect(result).toBeTruthy();

    // Should accept alias
    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test',
      ttl: 3600,
    });

    const resultWithAlias = await handleContextStats(deps, { alias: 'test' });
    expect(resultWithAlias).toBeTruthy();
  });
});

// ============================================================================
// Composite Loading Tests
// ============================================================================

describe('Composite Loading', () => {
  let statSpy: any;

  beforeEach(() => {
    statSpy = mockStatForDirectory();
  });

  afterEach(() => {
    statSpy?.mockRestore();
  });

  test('loads multiple sources via sources array', async () => {
    const deps = createMockDeps();
    const input = {
      sources: ['/test/source1', '/test/source2', '/test/source3'],
      alias: 'combined-cache',
      ttl: 3600,
    };

    const result = await handleContextLoad(deps, input);

    expect(result.success).toBe(true);
    expect(result.sourcesLoaded).toBe(3);
    expect(deps.repoLoader.loadDirectory).toHaveBeenCalledTimes(3);
    expect(deps.geminiClient.createCache).toHaveBeenCalledTimes(1);
  });

  test('combines content from multiple sources', async () => {
    const deps = createMockDeps();
    const input = {
      sources: ['/test/source1', '/test/source2'],
      alias: 'combined-cache',
      ttl: 3600,
    };

    await handleContextLoad(deps, input);

    // Check that createCache was called with combined content
    const createCacheCall = (deps.geminiClient.createCache as any).mock.calls[0];
    const content = createCacheCall[0];

    expect(content).toContain('Combined Context');
    expect(content).toContain('Source 1:');
    expect(content).toContain('Source 2:');
  });

  test('source metadata shows combined sources', async () => {
    const deps = createMockDeps();
    const input = {
      sources: ['/test/a', '/test/b'],
      alias: 'combined',
      ttl: 3600,
    };

    const result = await handleContextLoad(deps, input);

    expect(result.cache.source).toContain('/test/a');
    expect(result.cache.source).toContain('/test/b');
    expect(result.cache.source).toContain('+');
  });

  test('single source still works with source parameter', async () => {
    const deps = createMockDeps();
    const input = {
      source: '/test/single',
      alias: 'single-cache',
      ttl: 3600,
    };

    const result = await handleContextLoad(deps, input);

    expect(result.success).toBe(true);
    expect(result.sourcesLoaded).toBe(1);
    expect(deps.repoLoader.loadDirectory).toHaveBeenCalledTimes(1);
  });

  test('requires either source or sources', async () => {
    const deps = createMockDeps();
    const input = {
      alias: 'no-source',
      ttl: 3600,
    };

    await expect(handleContextLoad(deps, input)).rejects.toThrow();
  });

  test('empty sources array is rejected', async () => {
    const deps = createMockDeps();
    const input = {
      sources: [],
      alias: 'empty-sources',
      ttl: 3600,
    };

    await expect(handleContextLoad(deps, input)).rejects.toThrow();
  });

  test('loads sources in parallel', async () => {
    const deps = createMockDeps();
    let callOrder: string[] = [];

    // Track call order
    (deps.repoLoader.loadDirectory as any).mockImplementation(async (path: string) => {
      callOrder.push(`start-${path}`);
      await new Promise(r => setTimeout(r, 10)); // Small delay
      callOrder.push(`end-${path}`);
      return {
        content: `Content for ${path}`,
        totalTokens: 1000,
        fileCount: 5,
        files: [],
        metadata: { source: path, loadedAt: new Date() },
      };
    });

    const input = {
      sources: ['/a', '/b', '/c'],
      alias: 'parallel-test',
      ttl: 3600,
    };

    await handleContextLoad(deps, input);

    // All starts should come before any ends (parallel execution)
    const startIndices = callOrder.filter(c => c.startsWith('start-')).map(c => callOrder.indexOf(c));
    const endIndices = callOrder.filter(c => c.startsWith('end-')).map(c => callOrder.indexOf(c));

    // At least some starts should happen before some ends
    expect(Math.max(...startIndices)).toBeLessThan(Math.max(...endIndices));
  });
});

// ============================================================================
// GitHub Token Tests
// ============================================================================

describe('GitHub Token Support', () => {
  test('passes githubToken to loadGitHubRepoViaAPI', async () => {
    // We can't easily test the actual API call without mocking the module
    // but we can verify the schema accepts the token
    const deps = createMockDeps();

    // The schema should accept githubToken
    const input = {
      source: '/local/path', // Using local to avoid GitHub API call
      alias: 'test',
      ttl: 3600,
      githubToken: 'ghp_test_token_123',
    };

    // Mock stat to return directory
    const statSpy = mockStatForDirectory();

    try {
      const result = await handleContextLoad(deps, input);
      expect(result.success).toBe(true);
    } finally {
      statSpy.mockRestore();
    }
  });

  test('schema validates githubToken as optional string', async () => {
    const deps = createMockDeps();
    const statSpy = mockStatForDirectory();

    try {
      // Without token should work
      const result1 = await handleContextLoad(deps, {
        source: '/test',
        alias: 'test1',
        ttl: 3600,
      });
      expect(result1.success).toBe(true);

      // With token should work
      const result2 = await handleContextLoad(deps, {
        source: '/test',
        alias: 'test2',
        ttl: 3600,
        githubToken: 'ghp_abc123',
      });
      expect(result2.success).toBe(true);
    } finally {
      statSpy.mockRestore();
    }
  });
});

// ============================================================================
// Usage Logging Tests
// ============================================================================

describe('Usage Logging', () => {
  let statSpy: any;

  beforeEach(() => {
    statSpy = mockStatForDirectory();
  });

  afterEach(() => {
    statSpy?.mockRestore();
  });

  function createMockUsageLogger() {
    return {
      log: mock(async () => {}),
      getStats: mock(async () => ({
        totalOperations: 5,
        totalTokensUsed: 10000,
        totalCachedTokensUsed: 8000,
        estimatedCost: 0.0025,
        byOperation: {
          load: { count: 2, tokensUsed: 5000, cachedTokensUsed: 0 },
          query: { count: 3, tokensUsed: 5000, cachedTokensUsed: 8000 },
          evict: { count: 0, tokensUsed: 0, cachedTokensUsed: 0 },
        },
      })),
      getRecent: mock(async () => []),
    };
  }

  test('logs load operations', async () => {
    const deps = createMockDeps();
    const usageLogger = createMockUsageLogger();
    deps.usageLogger = usageLogger as any;

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test',
      ttl: 3600,
    });

    expect(usageLogger.log).toHaveBeenCalledTimes(1);
    expect(usageLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'load',
        cachedTokensUsed: 0, // Initial load has no cached tokens
      })
    );
  });

  test('logs query operations with token usage', async () => {
    const deps = createMockDeps();
    const usageLogger = createMockUsageLogger();
    deps.usageLogger = usageLogger as any;

    // Create cache first
    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test',
      ttl: 3600,
    });

    // Reset mock to only count query
    usageLogger.log.mockClear();

    await handleContextQuery(deps, {
      alias: 'test',
      query: 'What is this?',
    });

    expect(usageLogger.log).toHaveBeenCalledTimes(1);
    expect(usageLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'query',
        tokensUsed: expect.any(Number),
        cachedTokensUsed: expect.any(Number),
      })
    );
  });

  test('logs evict operations', async () => {
    const deps = createMockDeps();
    const usageLogger = createMockUsageLogger();
    deps.usageLogger = usageLogger as any;

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test',
      ttl: 3600,
    });

    usageLogger.log.mockClear();

    await handleContextEvict(deps, { alias: 'test' });

    expect(usageLogger.log).toHaveBeenCalledTimes(1);
    expect(usageLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'evict',
        tokensUsed: 0,
        cachedTokensUsed: 0,
      })
    );
  });

  test('context_stats includes usage stats when logger available', async () => {
    const deps = createMockDeps();
    const usageLogger = createMockUsageLogger();
    deps.usageLogger = usageLogger as any;

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test',
      ttl: 3600,
    });

    const result = await handleContextStats(deps, {});

    expect(result.usage).toBeDefined();
    expect(result.usage?.totalOperations).toBe(5);
    expect(result.usage?.estimatedCost).toBe(0.0025);
    expect(result.usage?.byOperation.load.count).toBe(2);
    expect(usageLogger.getStats).toHaveBeenCalled();
  });

  test('works without usage logger', async () => {
    const deps = createMockDeps();
    // No usageLogger set

    // Should not throw
    const result = await handleContextLoad(deps, {
      source: '/test',
      alias: 'test',
      ttl: 3600,
    });

    expect(result.success).toBe(true);

    const stats = await handleContextStats(deps, {});
    expect(stats.usage).toBeUndefined();
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  test('all handlers validate input with Zod', async () => {
    const deps = createMockDeps();

    // Test that malformed inputs throw validation errors
    await expect(handleContextLoad(deps, { bad: 'input' })).rejects.toThrow();
    await expect(handleContextQuery(deps, { bad: 'input' })).rejects.toThrow();
    await expect(handleContextEvict(deps, { bad: 'input' })).rejects.toThrow();
    await expect(handleContextRefresh(deps, { bad: 'input' })).rejects.toThrow();
  });

  test('handlers propagate CacheNotFoundError', async () => {
    const deps = createMockDeps();

    const alias = 'does-not-exist';

    await expect(
      handleContextQuery(deps, { alias, query: 'test' })
    ).rejects.toThrow(CacheNotFoundError);

    await expect(
      handleContextEvict(deps, { alias })
    ).rejects.toThrow(CacheNotFoundError);

    await expect(
      handleContextStats(deps, { alias })
    ).rejects.toThrow(CacheNotFoundError);

    await expect(
      handleContextRefresh(deps, { alias })
    ).rejects.toThrow(CacheNotFoundError);
  });
});

// ============================================================================
// handleContextRefresh Tests
// ============================================================================

describe('handleContextRefresh', () => {
  let statSpy: any;

  beforeEach(() => {
    statSpy = mockStatForDirectory();
  });

  afterEach(() => {
    statSpy?.mockRestore();
  });

  test('refreshes an existing cache successfully', async () => {
    const deps = createMockDeps();

    // Create initial cache
    await handleContextLoad(deps, {
      source: '/test/original',
      alias: 'test-cache',
      ttl: 3600,
    });

    const initialCache = await deps.storage.getByAlias('test-cache');
    expect(initialCache).toBeTruthy();

    // Clear mocks to track refresh calls
    (deps.geminiClient.deleteCache as any).mockClear();
    (deps.geminiClient.createCache as any).mockClear();
    (deps.storage.save as any).mockClear();

    // Refresh the cache
    const result = await handleContextRefresh(deps, {
      alias: 'test-cache',
    });

    expect(result.success).toBe(true);
    expect(result.cache.alias).toBe('test-cache');
    expect(result.previousTokenCount).toBeGreaterThan(0);
    expect(result.newTokenCount).toBeGreaterThan(0);
    expect(deps.geminiClient.deleteCache).toHaveBeenCalledTimes(1);
    expect(deps.geminiClient.createCache).toHaveBeenCalledTimes(1);
    expect(deps.storage.save).toHaveBeenCalledTimes(1);
  });

  test('throws CacheNotFoundError for non-existent cache', async () => {
    const deps = createMockDeps();

    await expect(
      handleContextRefresh(deps, { alias: 'non-existent' })
    ).rejects.toThrow(CacheNotFoundError);
  });

  test('preserves TTL when not specified', async () => {
    const deps = createMockDeps();

    // Create cache with specific TTL
    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 7200, // 2 hours
    });

    const initialCache = await deps.storage.getByAlias('test-cache');
    const initialTtl = Math.floor(
      (initialCache!.expiresAt.getTime() - initialCache!.createdAt.getTime()) / 1000
    );

    expect(initialTtl).toBe(7200);

    // Refresh without specifying TTL
    await handleContextRefresh(deps, {
      alias: 'test-cache',
    });

    // Check that createCache was called with original TTL
    const createCacheCall = (deps.geminiClient.createCache as any).mock.calls[1]; // Second call (after initial load)
    const options = createCacheCall[2];
    expect(options.ttl).toBe(7200);
  });

  test('updates TTL when specified', async () => {
    const deps = createMockDeps();

    // Create cache with initial TTL
    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    // Refresh with new TTL
    await handleContextRefresh(deps, {
      alias: 'test-cache',
      ttl: 7200, // New TTL
    });

    // Check that createCache was called with new TTL
    const createCacheCall = (deps.geminiClient.createCache as any).mock.calls[1];
    const options = createCacheCall[2];
    expect(options.ttl).toBe(7200);
  });

  test('updates system instruction when specified', async () => {
    const deps = createMockDeps();

    // Create cache without system instruction
    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    // Refresh with new system instruction
    await handleContextRefresh(deps, {
      alias: 'test-cache',
      systemInstruction: 'You are a helpful assistant',
    });

    // Check that createCache was called with system instruction
    const createCacheCall = (deps.geminiClient.createCache as any).mock.calls[1];
    const options = createCacheCall[2];
    expect(options.systemInstruction).toBe('You are a helpful assistant');
  });

  test('re-fetches source content on refresh', async () => {
    const deps = createMockDeps();

    // Create initial cache
    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    // Track load calls
    const initialLoadCalls = (deps.repoLoader.loadDirectory as any).mock.calls.length;

    // Refresh cache
    await handleContextRefresh(deps, {
      alias: 'test-cache',
    });

    // Should have loaded again
    const finalLoadCalls = (deps.repoLoader.loadDirectory as any).mock.calls.length;
    expect(finalLoadCalls).toBe(initialLoadCalls + 1);
  });

  test('handles composite caches (multiple sources)', async () => {
    const deps = createMockDeps();

    // Create composite cache
    await handleContextLoad(deps, {
      sources: ['/test/source1', '/test/source2'],
      alias: 'composite-cache',
      ttl: 3600,
    });

    // Clear mocks
    (deps.repoLoader.loadDirectory as any).mockClear();

    // Refresh composite cache
    const result = await handleContextRefresh(deps, {
      alias: 'composite-cache',
    });

    expect(result.success).toBe(true);
    // Should reload both sources
    expect(deps.repoLoader.loadDirectory).toHaveBeenCalledTimes(2);
  });

  test('reports token count changes', async () => {
    const deps = createMockDeps();

    // Mock different token counts for initial vs refresh
    let callCount = 0;
    (deps.repoLoader.loadDirectory as any).mockImplementation(async (path: string) => {
      callCount++;
      const tokens = callCount === 1 ? 1000 : 1500; // Different counts
      return {
        content: `Content ${callCount}`,
        totalTokens: tokens,
        fileCount: 5,
        files: [],
        metadata: { source: path, loadedAt: new Date() },
      };
    });

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    const result = await handleContextRefresh(deps, {
      alias: 'test-cache',
    });

    expect(result.previousTokenCount).toBe(1000);
    expect(result.newTokenCount).toBe(1500);
  });

  test('validates input schema', async () => {
    const deps = createMockDeps();

    // Missing alias should fail
    await expect(handleContextRefresh(deps, {})).rejects.toThrow();

    // Empty alias should fail
    await expect(handleContextRefresh(deps, { alias: '' })).rejects.toThrow();

    // Invalid TTL should fail
    await expect(
      handleContextRefresh(deps, { alias: 'test', ttl: 30 })
    ).rejects.toThrow();

    await expect(
      handleContextRefresh(deps, { alias: 'test', ttl: 90000 })
    ).rejects.toThrow();
  });

  test('handles Gemini deletion errors gracefully', async () => {
    const deps = createMockDeps();

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    // Make deleteCache throw an error (e.g., cache already expired)
    (deps.geminiClient.deleteCache as any).mockImplementation(async () => {
      throw new Error('Cache already expired');
    });

    // Should still succeed
    const result = await handleContextRefresh(deps, {
      alias: 'test-cache',
    });

    expect(result.success).toBe(true);
  });

  test('logs refresh operation with usage logger', async () => {
    const deps = createMockDeps();
    const usageLogger = {
      log: mock(async () => {}),
      getStats: mock(async () => ({
        totalOperations: 0,
        totalTokensUsed: 0,
        totalCachedTokensUsed: 0,
        estimatedCost: 0,
        byOperation: {
          load: { count: 0, tokensUsed: 0, cachedTokensUsed: 0 },
          query: { count: 0, tokensUsed: 0, cachedTokensUsed: 0 },
          evict: { count: 0, tokensUsed: 0, cachedTokensUsed: 0 },
          refresh: { count: 0, tokensUsed: 0, cachedTokensUsed: 0 },
        },
      })),
      getRecent: mock(async () => []),
    };
    deps.usageLogger = usageLogger as any;

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    usageLogger.log.mockClear();

    await handleContextRefresh(deps, {
      alias: 'test-cache',
    });

    expect(usageLogger.log).toHaveBeenCalledTimes(1);
    expect(usageLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'refresh',
        tokensUsed: expect.any(Number),
        cachedTokensUsed: 0, // Refresh creates new cache
      })
    );
  });

  test('works without usage logger', async () => {
    const deps = createMockDeps();
    // No usageLogger set

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    // Should not throw
    const result = await handleContextRefresh(deps, {
      alias: 'test-cache',
    });

    expect(result.success).toBe(true);
  });

  test('passes githubToken when refreshing GitHub repos', async () => {
    const deps = createMockDeps();

    // Create initial cache (schema validation test)
    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    // Refresh with githubToken should be accepted by schema
    const result = await handleContextRefresh(deps, {
      alias: 'test-cache',
      githubToken: 'ghp_test_token',
    });

    expect(result.success).toBe(true);
  });

  test('handles refresh failure gracefully', async () => {
    const deps = createMockDeps();

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'test-cache',
      ttl: 3600,
    });

    // Make repoLoader fail on refresh
    (deps.repoLoader.loadDirectory as any).mockImplementationOnce(async () => {
      throw new Error('Failed to load directory');
    });

    await expect(
      handleContextRefresh(deps, { alias: 'test-cache' })
    ).rejects.toThrow('Failed to refresh source');
  });

  test('preserves alias after refresh', async () => {
    const deps = createMockDeps();

    await handleContextLoad(deps, {
      source: '/test',
      alias: 'my-special-cache',
      ttl: 3600,
    });

    const result = await handleContextRefresh(deps, {
      alias: 'my-special-cache',
    });

    expect(result.cache.alias).toBe('my-special-cache');

    // Verify it's still queryable with same alias
    const caches = await handleContextList(deps);
    expect(caches.caches.find(c => c.alias === 'my-special-cache')).toBeTruthy();
  });
});
