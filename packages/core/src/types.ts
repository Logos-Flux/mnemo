import { z } from 'zod';

// ============================================================================
// Cache Types
// ============================================================================

export const CacheMetadataSchema = z.object({
  /** Unique cache identifier (from Gemini) */
  name: z.string(),
  /** User-friendly alias for this cache */
  alias: z.string(),
  /** Number of tokens in the cache */
  tokenCount: z.number(),
  /** When the cache was created */
  createdAt: z.date(),
  /** When the cache will expire */
  expiresAt: z.date(),
  /** Original source (path, URL, etc.) */
  source: z.string(),
  /** Model used for the cache */
  model: z.string().optional(),
});

export type CacheMetadata = z.infer<typeof CacheMetadataSchema>;

export const CacheListItemSchema = z.object({
  alias: z.string(),
  tokenCount: z.number(),
  expiresAt: z.date(),
  source: z.string(),
});

export type CacheListItem = z.infer<typeof CacheListItemSchema>;

// ============================================================================
// Load Options
// ============================================================================

export const LoadOptionsSchema = z.object({
  /** User-friendly alias for this cache */
  alias: z.string().min(1).max(64),
  /** Time to live in seconds (default: 3600 = 1 hour) */
  ttl: z.number().min(60).max(86400).optional().default(3600),
  /** Glob patterns to include (default: all files) */
  includePatterns: z.array(z.string()).optional(),
  /** Glob patterns to exclude (in addition to .gitignore) */
  excludePatterns: z.array(z.string()).optional(),
  /** System instruction for the cached content */
  systemInstruction: z.string().optional(),
  /** Maximum tokens to load (will truncate if exceeded) */
  maxTokens: z.number().optional(),
});

export type LoadOptions = z.infer<typeof LoadOptionsSchema>;

// ============================================================================
// Query Types
// ============================================================================

export const QueryOptionsSchema = z.object({
  /** Maximum tokens in response */
  maxOutputTokens: z.number().optional(),
  /** Temperature for generation */
  temperature: z.number().min(0).max(2).optional(),
  /** Stop sequences */
  stopSequences: z.array(z.string()).optional(),
});

export type QueryOptions = z.infer<typeof QueryOptionsSchema>;

export const QueryResultSchema = z.object({
  /** The response text */
  response: z.string(),
  /** Total tokens used in this request */
  tokensUsed: z.number(),
  /** Tokens served from cache (discounted) */
  cachedTokensUsed: z.number(),
  /** Model used */
  model: z.string(),
});

export type QueryResult = z.infer<typeof QueryResultSchema>;

// ============================================================================
// Source Types
// ============================================================================

export const FileInfoSchema = z.object({
  /** Relative path from root */
  path: z.string(),
  /** File content */
  content: z.string(),
  /** File size in bytes */
  size: z.number(),
  /** Estimated token count */
  tokenEstimate: z.number(),
  /** MIME type if detectable */
  mimeType: z.string().optional(),
});

export type FileInfo = z.infer<typeof FileInfoSchema>;

export const LoadedSourceSchema = z.object({
  /** Combined content ready for caching */
  content: z.string(),
  /** Total estimated tokens */
  totalTokens: z.number(),
  /** Number of files loaded */
  fileCount: z.number(),
  /** Individual file info */
  files: z.array(FileInfoSchema),
  /** Source metadata */
  metadata: z.object({
    source: z.string(),
    loadedAt: z.date(),
    gitCommit: z.string().optional(),
    branch: z.string().optional(),
    /** Original URL if loaded from remote */
    originalSource: z.string().optional(),
    /** Owner/repo if cloned from GitHub */
    clonedFrom: z.string().optional(),
  }).passthrough(), // Allow additional properties for adapters
});

export type LoadedSource = z.infer<typeof LoadedSourceSchema>;

// ============================================================================
// Storage Interface
// ============================================================================

export interface CacheStorage {
  /** Save cache metadata */
  save(metadata: CacheMetadata): Promise<void>;
  /** Get cache by alias */
  getByAlias(alias: string): Promise<CacheMetadata | null>;
  /** Get cache by Gemini name */
  getByName(name: string): Promise<CacheMetadata | null>;
  /** List all caches */
  list(): Promise<CacheListItem[]>;
  /** Delete cache by alias */
  deleteByAlias(alias: string): Promise<boolean>;
  /** Update cache (e.g., extend TTL) */
  update(alias: string, updates: Partial<CacheMetadata>): Promise<void>;
}

// ============================================================================
// Usage Logging
// ============================================================================

export type UsageOperation = 'load' | 'query' | 'evict' | 'refresh';

export interface UsageEntry {
  /** Cache ID (internal, not alias) */
  cacheId: string;
  /** Operation type */
  operation: UsageOperation;
  /** Input tokens used (for queries) */
  tokensUsed: number;
  /** Tokens served from cache (discounted pricing) */
  cachedTokensUsed: number;
  /** When the operation occurred */
  createdAt: Date;
}

export interface UsageStats {
  /** Total operations */
  totalOperations: number;
  /** Total input tokens */
  totalTokensUsed: number;
  /** Total cached tokens */
  totalCachedTokensUsed: number;
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Breakdown by operation */
  byOperation: Record<UsageOperation, { count: number; tokensUsed: number; cachedTokensUsed: number }>;
}

export interface UsageLogger {
  /** Log a usage event */
  log(entry: Omit<UsageEntry, 'createdAt'>): Promise<void>;
  /** Get usage stats for a cache */
  getStats(cacheId?: string): Promise<UsageStats>;
  /** Get recent usage entries */
  getRecent(limit?: number): Promise<UsageEntry[]>;
}

// Gemini pricing (as of 2024) - per 1M tokens
export const GEMINI_PRICING = {
  // gemini-2.0-flash
  'gemini-2.0-flash-001': {
    input: 0.10,        // $0.10 per 1M input tokens
    cachedInput: 0.025, // $0.025 per 1M cached tokens (75% discount)
    output: 0.40,       // $0.40 per 1M output tokens
  },
  // Default fallback
  default: {
    input: 0.10,
    cachedInput: 0.025,
    output: 0.40,
  },
} as const;

/**
 * Calculate estimated cost from token usage
 */
export function calculateCost(
  tokensUsed: number,
  cachedTokensUsed: number,
  model = 'default'
): number {
  const pricing = GEMINI_PRICING[model as keyof typeof GEMINI_PRICING] ?? GEMINI_PRICING.default;
  const regularTokens = tokensUsed - cachedTokensUsed;
  const cost =
    (regularTokens / 1_000_000) * pricing.input +
    (cachedTokensUsed / 1_000_000) * pricing.cachedInput;
  return Math.round(cost * 1_000_000) / 1_000_000; // Round to 6 decimals
}

// ============================================================================
// Error Types
// ============================================================================

export class MnemoError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MnemoError';
  }
}

export class CacheNotFoundError extends MnemoError {
  constructor(alias: string) {
    super(`Cache not found: ${alias}`, 'CACHE_NOT_FOUND', { alias });
    this.name = 'CacheNotFoundError';
  }
}

export class CacheExpiredError extends MnemoError {
  constructor(alias: string) {
    super(`Cache expired: ${alias}`, 'CACHE_EXPIRED', { alias });
    this.name = 'CacheExpiredError';
  }
}

export class LoadError extends MnemoError {
  constructor(source: string, reason: string) {
    super(`Failed to load source: ${reason}`, 'LOAD_ERROR', { source, reason });
    this.name = 'LoadError';
  }
}

export class TokenLimitError extends MnemoError {
  constructor(requested: number, limit: number) {
    super(
      `Token limit exceeded: ${requested} > ${limit}`,
      'TOKEN_LIMIT_EXCEEDED',
      { requested, limit }
    );
    this.name = 'TokenLimitError';
  }
}

// ============================================================================
// Config Types
// ============================================================================

export const MnemoConfigSchema = z.object({
  /** Gemini API key */
  geminiApiKey: z.string(),
  /** Default model for caching */
  defaultModel: z.string().default('gemini-2.0-flash-001'),
  /** Default TTL in seconds */
  defaultTtl: z.number().default(3600),
  /** Maximum tokens per cache */
  maxTokensPerCache: z.number().default(900000), // Leave room under 1M
});

export type MnemoConfig = z.infer<typeof MnemoConfigSchema>;
