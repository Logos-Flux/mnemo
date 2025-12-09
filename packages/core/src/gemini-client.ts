import { GoogleGenAI } from '@google/genai';
import type {
  CacheMetadata,
  QueryResult,
  QueryOptions,
  MnemoConfig,
} from './types';
import { CacheNotFoundError, MnemoError } from './types';

/**
 * Wrapper around Google's GenAI SDK with focus on context caching
 */
export class GeminiClient {
  private ai: GoogleGenAI;
  private config: MnemoConfig;

  constructor(config: MnemoConfig) {
    this.config = config;
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  /**
   * Create a new context cache
   * @param content - The content to cache
   * @param alias - User-friendly name for this cache
   * @param options - Cache options (TTL, system instruction, etc.)
   * @returns Cache metadata including the Gemini cache name
   */
  async createCache(
    content: string,
    alias: string,
    options: {
      ttl?: number;
      systemInstruction?: string;
      model?: string;
    } = {}
  ): Promise<CacheMetadata> {
    const model = options.model ?? this.config.defaultModel;
    const ttl = options.ttl ?? this.config.defaultTtl;

    try {
      const cache = await this.ai.caches.create({
        model,
        config: {
          contents: [
            {
              role: 'user',
              parts: [{ text: content }],
            },
          ],
          systemInstruction: options.systemInstruction,
          ttl: `${ttl}s`,
        },
      });

      const expiresAt = new Date(Date.now() + ttl * 1000);

      return {
        name: cache.name!,
        alias,
        tokenCount: cache.usageMetadata?.totalTokenCount ?? 0,
        createdAt: new Date(),
        expiresAt,
        source: alias, // Will be overwritten by caller with actual source
        model,
      };
    } catch (error) {
      throw new MnemoError(
        `Failed to create cache: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CACHE_CREATE_FAILED',
        { alias, model }
      );
    }
  }

  /**
   * Query a cached context
   * @param cacheName - The Gemini cache name (not alias)
   * @param query - The question or instruction
   * @param options - Query options
   * @returns Query result with response and token usage
   */
  async queryCache(
    cacheName: string,
    query: string,
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.config.defaultModel,
        contents: query,
        config: {
          cachedContent: cacheName,
          maxOutputTokens: options.maxOutputTokens,
          temperature: options.temperature,
          stopSequences: options.stopSequences,
        },
      });

      const usage = response.usageMetadata;

      return {
        response: response.text ?? '',
        tokensUsed: usage?.totalTokenCount ?? 0,
        cachedTokensUsed: usage?.cachedContentTokenCount ?? 0,
        model: this.config.defaultModel,
      };
    } catch (error) {
      // Check if cache not found
      if (error instanceof Error && error.message.includes('not found')) {
        throw new CacheNotFoundError(cacheName);
      }
      throw new MnemoError(
        `Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'QUERY_FAILED',
        { cacheName }
      );
    }
  }

  /**
   * List all caches
   * @returns Array of cache metadata from Gemini
   */
  async listCaches(): Promise<
    Array<{
      name: string;
      displayName?: string;
      model?: string;
      createTime?: string;
      expireTime?: string;
      usageMetadata?: {
        totalTokenCount?: number;
      };
    }>
  > {
    try {
      const caches: Array<{
        name: string;
        displayName?: string;
        model?: string;
        createTime?: string;
        expireTime?: string;
        usageMetadata?: {
          totalTokenCount?: number;
        };
      }> = [];

      // The SDK returns an async iterator
      const cacheList = this.ai.caches.list();
      for await (const cache of cacheList as any) {
        caches.push({
          name: cache.name ?? '',
          displayName: cache.displayName,
          model: cache.model,
          createTime: cache.createTime,
          expireTime: cache.expireTime,
          usageMetadata: cache.usageMetadata,
        });
      }

      return caches;
    } catch (error) {
      throw new MnemoError(
        `Failed to list caches: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LIST_FAILED'
      );
    }
  }

  /**
   * Get a specific cache by name
   * @param cacheName - The Gemini cache name
   * @returns Cache details or null if not found
   */
  async getCache(cacheName: string): Promise<{
    name: string;
    model?: string;
    expireTime?: string;
    usageMetadata?: {
      totalTokenCount?: number;
    };
  } | null> {
    try {
      const cache = await this.ai.caches.get({ name: cacheName });
      return {
        name: cache.name ?? '',
        model: cache.model,
        expireTime: cache.expireTime,
        usageMetadata: cache.usageMetadata,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete a cache
   * @param cacheName - The Gemini cache name to delete
   */
  async deleteCache(cacheName: string): Promise<void> {
    try {
      await this.ai.caches.delete({ name: cacheName });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new CacheNotFoundError(cacheName);
      }
      throw new MnemoError(
        `Failed to delete cache: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DELETE_FAILED',
        { cacheName }
      );
    }
  }

  /**
   * Update cache TTL
   * @param cacheName - The Gemini cache name
   * @param ttl - New TTL in seconds
   */
  async updateCacheTtl(cacheName: string, ttl: number): Promise<void> {
    try {
      await this.ai.caches.update({
        name: cacheName,
        config: {
          ttl: `${ttl}s`,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new CacheNotFoundError(cacheName);
      }
      throw new MnemoError(
        `Failed to update cache: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UPDATE_FAILED',
        { cacheName, ttl }
      );
    }
  }

  /**
   * Estimate token count for content
   * Simple estimation: ~4 chars per token for English text
   * More accurate would use the tokenizer, but this is good enough for planning
   */
  estimateTokens(content: string): number {
    // Rough estimate: 1 token ≈ 4 characters for English
    // Code tends to be denser, so we use 3.5
    return Math.ceil(content.length / 3.5);
  }
}
