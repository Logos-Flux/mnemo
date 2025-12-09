import {
  GeminiClient,
  RepoLoader,
  SourceLoader,
  type CacheMetadata,
  type CacheStorage,
  type QueryResult,
  type UsageLogger,
  type UsageStats,
  type LoadedSource,
  CacheNotFoundError,
  isUrl,
  isGitHubUrl,
  loadGitHubRepoViaAPI,
  calculateCost,
  UrlAdapter,
  isGenericUrl,
} from '@mnemo/core';
import {
  contextLoadSchema,
  contextQuerySchema,
  contextEvictSchema,
  contextStatsSchema,
  contextRefreshSchema,
  type ContextLoadInput,
  type ContextQueryInput,
  type ContextEvictInput,
  type ContextStatsInput,
  type ContextRefreshInput,
} from './schemas';
import { stat } from 'node:fs/promises';

export interface ToolHandlerDeps {
  geminiClient: GeminiClient;
  storage: CacheStorage;
  repoLoader: RepoLoader;
  sourceLoader: SourceLoader;
  urlAdapter?: UrlAdapter;
  usageLogger?: UsageLogger;
}

/**
 * Load a single source (helper for composite loading)
 * Supports: GitHub repos, generic URLs (via UrlAdapter), local files/directories
 */
async function loadSingleSource(
  source: string,
  deps: ToolHandlerDeps,
  githubToken?: string
): Promise<LoadedSource> {
  const { repoLoader, sourceLoader, urlAdapter } = deps;

  if (isGitHubUrl(source)) {
    return loadGitHubRepoViaAPI(source, { githubToken });
  } else if (isGenericUrl(source)) {
    // Use URL adapter for non-GitHub URLs
    if (!urlAdapter) {
      throw new Error('URL adapter not configured. Cannot load generic URLs.');
    }
    return urlAdapter.load({ type: 'url', url: source });
  } else if (isUrl(source)) {
    // Fallback for other URL types (shouldn't normally hit this)
    throw new Error('Only GitHub URLs and HTTP/HTTPS URLs are supported for remote loading');
  } else {
    const stats = await stat(source);
    if (stats.isDirectory()) {
      return repoLoader.loadDirectory(source);
    } else {
      return sourceLoader.loadFile(source);
    }
  }
}

/**
 * Combine multiple loaded sources into one
 */
function combineLoadedSources(sources: LoadedSource[], sourceNames: string[]): LoadedSource {
  const allFiles = sources.flatMap((s) => s.files);
  const totalTokens = sources.reduce((sum, s) => sum + s.totalTokens, 0);
  const fileCount = sources.reduce((sum, s) => sum + s.fileCount, 0);

  // Build combined content
  const lines: string[] = [];
  lines.push('# Combined Context');
  lines.push(`# Sources: ${sourceNames.join(', ')}`);
  lines.push(`# Total Files: ${fileCount}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('');

  for (let i = 0; i < sources.length; i++) {
    lines.push(`## Source ${i + 1}: ${sourceNames[i]}`);
    lines.push('');
    lines.push(sources[i].content);
    lines.push('');
  }

  return {
    content: lines.join('\n'),
    totalTokens,
    fileCount,
    files: allFiles,
    metadata: {
      source: sourceNames.join(' + '),
      loadedAt: new Date(),
    },
  };
}

/**
 * Load a source into the context cache
 */
export async function handleContextLoad(
  deps: ToolHandlerDeps,
  rawInput: unknown
): Promise<{ success: true; cache: CacheMetadata; sourcesLoaded: number }> {
  const input = contextLoadSchema.parse(rawInput);
  const { geminiClient, storage } = deps;

  // Check if alias already exists
  const existing = await storage.getByAlias(input.alias);
  if (existing) {
    // Evict existing cache first
    try {
      await geminiClient.deleteCache(existing.name);
    } catch {
      // Ignore if already expired
    }
    await storage.deleteByAlias(input.alias);
  }

  // Get list of sources to load
  const sourcesToLoad = input.sources ?? (input.source ? [input.source] : []);
  if (sourcesToLoad.length === 0) {
    throw new Error('No sources provided');
  }

  // Load all sources
  let loadedSource: LoadedSource;
  try {
    if (sourcesToLoad.length === 1) {
      loadedSource = await loadSingleSource(sourcesToLoad[0], deps, input.githubToken);
    } else {
      // Composite loading - load all and combine
      const loadedSources = await Promise.all(
        sourcesToLoad.map((s) => loadSingleSource(s, deps, input.githubToken))
      );
      loadedSource = combineLoadedSources(loadedSources, sourcesToLoad);
    }
  } catch (error) {
    throw new Error(`Failed to load source: ${(error as Error).message}`);
  }

  // Create Gemini cache
  const cacheMetadata = await geminiClient.createCache(
    loadedSource.content,
    input.alias,
    {
      ttl: input.ttl,
      systemInstruction: input.systemInstruction,
    }
  );

  // Update with actual source info
  cacheMetadata.source = loadedSource.metadata.source;
  cacheMetadata.tokenCount = loadedSource.totalTokens;

  // Store in local storage
  await storage.save(cacheMetadata);

  // Log usage
  if (deps.usageLogger) {
    await deps.usageLogger.log({
      cacheId: cacheMetadata.name,
      operation: 'load',
      tokensUsed: loadedSource.totalTokens,
      cachedTokensUsed: 0, // Initial load isn't cached yet
    });
  }

  return { success: true, cache: cacheMetadata, sourcesLoaded: sourcesToLoad.length };
}

/**
 * Query a cached context
 */
export async function handleContextQuery(
  deps: ToolHandlerDeps,
  rawInput: unknown
): Promise<QueryResult> {
  const input = contextQuerySchema.parse(rawInput);
  const { geminiClient, storage } = deps;

  // Get cache by alias
  const cache = await storage.getByAlias(input.alias);
  if (!cache) {
    throw new CacheNotFoundError(input.alias);
  }

  // Check if expired
  if (new Date() > cache.expiresAt) {
    await storage.deleteByAlias(input.alias);
    throw new CacheNotFoundError(input.alias);
  }

  // Query the cache
  const result = await geminiClient.queryCache(cache.name, input.query, {
    maxOutputTokens: input.maxTokens,
    temperature: input.temperature,
  });

  // Log usage
  if (deps.usageLogger) {
    await deps.usageLogger.log({
      cacheId: cache.name,
      operation: 'query',
      tokensUsed: result.tokensUsed,
      cachedTokensUsed: result.cachedTokensUsed,
    });
  }

  return result;
}

/**
 * List all active caches
 */
export async function handleContextList(
  deps: ToolHandlerDeps
): Promise<{ caches: Array<{ alias: string; tokenCount: number; expiresAt: string; source: string }> }> {
  const { storage } = deps;
  const caches = await storage.list();

  return {
    caches: caches.map((c) => ({
      alias: c.alias,
      tokenCount: c.tokenCount,
      expiresAt: c.expiresAt.toISOString(),
      source: c.source,
    })),
  };
}

/**
 * Evict a cache
 */
export async function handleContextEvict(
  deps: ToolHandlerDeps,
  rawInput: unknown
): Promise<{ success: true; alias: string }> {
  const input = contextEvictSchema.parse(rawInput);
  const { geminiClient, storage } = deps;

  // Get cache by alias
  const cache = await storage.getByAlias(input.alias);
  if (!cache) {
    throw new CacheNotFoundError(input.alias);
  }

  // Delete from Gemini
  try {
    await geminiClient.deleteCache(cache.name);
  } catch {
    // Might already be expired, that's ok
  }

  // Log usage before deleting
  if (deps.usageLogger) {
    await deps.usageLogger.log({
      cacheId: cache.name,
      operation: 'evict',
      tokensUsed: 0,
      cachedTokensUsed: 0,
    });
  }

  // Delete from local storage
  await storage.deleteByAlias(input.alias);

  return { success: true, alias: input.alias };
}

/**
 * Get usage statistics
 */
export async function handleContextStats(
  deps: ToolHandlerDeps,
  rawInput: unknown
): Promise<{
  totalCaches: number;
  totalTokens: number;
  usage?: UsageStats;
  caches?: Array<{ alias: string; tokenCount: number }>;
}> {
  const input = contextStatsSchema.parse(rawInput);
  const { storage, usageLogger } = deps;

  const allCaches = await storage.list();

  // Get usage stats if logger is available
  const usage = usageLogger ? await usageLogger.getStats() : undefined;

  if (input.alias) {
    // Stats for specific cache
    const cache = allCaches.find((c) => c.alias === input.alias);
    if (!cache) {
      throw new CacheNotFoundError(input.alias);
    }
    return {
      totalCaches: 1,
      totalTokens: cache.tokenCount,
      usage,
      caches: [{ alias: cache.alias, tokenCount: cache.tokenCount }],
    };
  }

  // Global stats
  const totalTokens = allCaches.reduce((sum, c) => sum + c.tokenCount, 0);

  return {
    totalCaches: allCaches.length,
    totalTokens,
    usage,
    caches: allCaches.map((c) => ({
      alias: c.alias,
      tokenCount: c.tokenCount,
    })),
  };
}

/**
 * Refresh an existing cache by re-fetching source content
 */
export async function handleContextRefresh(
  deps: ToolHandlerDeps,
  rawInput: unknown
): Promise<{ success: true; cache: CacheMetadata; previousTokenCount: number; newTokenCount: number }> {
  const input = contextRefreshSchema.parse(rawInput);
  const { geminiClient, storage } = deps;

  // Get existing cache
  const existingCache = await storage.getByAlias(input.alias);
  if (!existingCache) {
    throw new CacheNotFoundError(input.alias);
  }

  // Store previous metadata
  const previousTokenCount = existingCache.tokenCount;
  const previousSource = existingCache.source;

  // Determine sources to load (parse the source field for composite caches)
  const sourcesToLoad = previousSource.includes(' + ')
    ? previousSource.split(' + ')
    : [previousSource];

  // Use previous TTL if not specified, otherwise use new TTL
  const ttl = input.ttl ?? Math.floor((existingCache.expiresAt.getTime() - existingCache.createdAt.getTime()) / 1000);

  // Re-load all sources
  let loadedSource: LoadedSource;
  try {
    if (sourcesToLoad.length === 1) {
      loadedSource = await loadSingleSource(sourcesToLoad[0], deps, input.githubToken);
    } else {
      // Composite loading - load all and combine
      const loadedSources = await Promise.all(
        sourcesToLoad.map((s) => loadSingleSource(s, deps, input.githubToken))
      );
      loadedSource = combineLoadedSources(loadedSources, sourcesToLoad);
    }
  } catch (error) {
    throw new Error(`Failed to refresh source: ${(error as Error).message}`);
  }

  // Delete old cache from Gemini
  try {
    await geminiClient.deleteCache(existingCache.name);
  } catch {
    // Ignore if already expired
  }

  // Create new Gemini cache with refreshed content
  const cacheMetadata = await geminiClient.createCache(
    loadedSource.content,
    input.alias,
    {
      ttl,
      systemInstruction: input.systemInstruction,
    }
  );

  // Update with actual source info
  cacheMetadata.source = loadedSource.metadata.source;
  cacheMetadata.tokenCount = loadedSource.totalTokens;

  // Store updated metadata
  await storage.save(cacheMetadata);

  // Log usage
  if (deps.usageLogger) {
    await deps.usageLogger.log({
      cacheId: cacheMetadata.name,
      operation: 'refresh',
      tokensUsed: loadedSource.totalTokens,
      cachedTokensUsed: 0, // Refresh creates new cache, no cached tokens yet
    });
  }

  return {
    success: true,
    cache: cacheMetadata,
    previousTokenCount,
    newTokenCount: loadedSource.totalTokens,
  };
}
