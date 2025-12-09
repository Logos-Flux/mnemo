/**
 * URL Adapter
 * Load content from arbitrary URLs into Mnemo context caches
 */

import type { SourceAdapter, SourceConfig, AdapterLoadOptions } from './base';
import type { LoadedSource } from '../types';
import { LoadError } from '../types';
import { TokenTargetCrawler, type CrawlConfig } from './url-adapter/crawler';
import { createDefaultRegistry, type ExtractorRegistry } from './extractors';

/**
 * Configuration for URL adapter
 */
export interface UrlAdapterConfig extends SourceConfig {
  type: 'url';

  /** Single URL to load */
  url?: string;

  /** Multiple seed URLs for crawling */
  urls?: string[];

  /** Stop crawling when this token count reached (default: 100000) */
  targetTokens?: number;

  /** Skip pages with fewer tokens than this (default: 500) */
  minTokensPerPage?: number;

  /** Hard cap on pages to load (default: 50) */
  maxPages?: number;

  /** Only follow links on same domain (default: true) */
  sameDomainOnly?: boolean;

  /** Delay between requests in ms (default: 100) */
  delayMs?: number;

  /** Respect robots.txt (default: true) */
  respectRobotsTxt?: boolean;

  /** Maximum subrequests (for Cloudflare Workers limit of 50) */
  maxSubrequests?: number;
}

/**
 * URL Adapter
 * Loads content from any HTTP/HTTPS URL
 *
 * Features:
 * - HTML extraction via Readability + cheerio
 * - PDF text extraction
 * - JSON formatting with structure summary
 * - Token-targeted crawling
 * - robots.txt compliance
 * - Intelligent link scoring
 */
/**
 * Options for constructing a UrlAdapter
 */
export interface UrlAdapterOptions {
  extractorRegistry?: ExtractorRegistry;
  userAgent?: string;
  /** Default max subrequests (for Cloudflare Workers, use 40) */
  maxSubrequests?: number;
}

export class UrlAdapter implements SourceAdapter {
  readonly type = 'url';
  readonly name = 'URL Loader';

  private extractorRegistry: ExtractorRegistry;
  private userAgent: string;
  private defaultMaxSubrequests?: number;

  constructor(options?: UrlAdapterOptions) {
    this.extractorRegistry = options?.extractorRegistry ?? createDefaultRegistry();
    this.userAgent =
      options?.userAgent ?? 'Mnemo/0.2.0 (https://github.com/logos-flux/mnemo; context-loader)';
    this.defaultMaxSubrequests = options?.maxSubrequests;
  }

  /**
   * Check if this adapter can handle the source
   */
  canHandle(source: SourceConfig): boolean {
    // Handle explicit type: 'url' configs
    if (source.type === 'url') {
      return !!(source.url || (source as UrlAdapterConfig).urls);
    }

    // Also handle any URL string that isn't GitHub
    if (source.url) {
      try {
        const url = new URL(source.url);
        // Only handle HTTP(S) and not GitHub
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.hostname.includes('github.com')
        );
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Load content from URL(s)
   */
  async load(
    source: SourceConfig,
    options?: AdapterLoadOptions
  ): Promise<LoadedSource> {
    const config = source as UrlAdapterConfig;

    // Validate we have at least one URL
    const seedUrls = config.urls ?? (config.url ? [config.url] : []);
    if (seedUrls.length === 0) {
      throw new LoadError('url', 'No URL provided');
    }

    // Validate URLs
    for (const url of seedUrls) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new LoadError(url, 'Only HTTP/HTTPS URLs are supported');
        }
      } catch {
        throw new LoadError(url, 'Invalid URL format');
      }
    }

    // Build crawler config with defaults
    const crawlConfig: CrawlConfig = {
      seedUrls,
      targetTokens: config.targetTokens ?? options?.maxTokens ?? 100000,
      minTokensPerPage: config.minTokensPerPage ?? 500,
      maxPages: config.maxPages ?? 50,
      sameDomainOnly: config.sameDomainOnly ?? true,
      delayMs: config.delayMs ?? 100,
      respectRobotsTxt: config.respectRobotsTxt ?? true,
      maxSubrequests: config.maxSubrequests ?? this.defaultMaxSubrequests,
    };

    try {
      const crawler = new TokenTargetCrawler(
        crawlConfig,
        this.extractorRegistry,
        this.userAgent
      );
      return await crawler.crawl();
    } catch (error) {
      throw new LoadError(
        seedUrls.join(', '),
        `Crawl failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Helper to check if a string is a non-GitHub URL
 */
export function isGenericUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.hostname.includes('github.com')
    );
  } catch {
    return false;
  }
}
