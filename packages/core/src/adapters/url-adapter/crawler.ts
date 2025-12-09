/**
 * Token-targeted web crawler
 * Crawls pages until a target token count is reached
 */

import type { FileInfo, LoadedSource } from '../../types';
import type { ExtractorRegistry } from '../extractors/types';
import { RobotsChecker } from './robots';
import { scoreLink, shouldSkipUrl, normalizeUrl } from './link-scorer';

/**
 * Configuration for crawling
 */
export interface CrawlConfig {
  /** Seed URLs to start crawling from */
  seedUrls: string[];
  /** Stop crawling when this token count reached */
  targetTokens: number;
  /** Skip pages with fewer tokens than this */
  minTokensPerPage: number;
  /** Hard cap on pages to load */
  maxPages: number;
  /** Only follow links on same domain */
  sameDomainOnly: boolean;
  /** Delay between requests in ms */
  delayMs: number;
  /** Respect robots.txt */
  respectRobotsTxt: boolean;
  /** Maximum subrequests (for Cloudflare Workers limit of 50) */
  maxSubrequests?: number;
}

/**
 * URL in the crawl queue with priority
 */
interface PrioritizedUrl {
  url: string;
  score: number;
  depth: number;
  referrer: string;
}

/**
 * Error encountered during crawling
 */
interface CrawlError {
  url: string;
  error: string;
  timestamp: Date;
}

/**
 * Extended FileInfo with links for crawling
 */
interface LoadedPage extends FileInfo {
  links?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Token-targeted web crawler
 * Intelligently crawls web pages until target token count is reached
 */
export class TokenTargetCrawler {
  private visited = new Set<string>();
  private queue: PrioritizedUrl[] = [];
  private loadedContent: LoadedPage[] = [];
  private errors: CrawlError[] = [];
  private currentTokens = 0;
  private robotsCache = new Map<string, RobotsChecker>();
  private subrequestCount = 0;

  constructor(
    private config: CrawlConfig,
    private extractorRegistry: ExtractorRegistry,
    private userAgent: string
  ) {}

  /**
   * Execute the crawl
   * @returns Loaded source with all crawled content
   */
  async crawl(): Promise<LoadedSource> {
    // 1. Seed queue with initial URLs
    for (const url of this.config.seedUrls) {
      const normalized = normalizeUrl(url);
      this.queue.push({ url: normalized, score: 100, depth: 0, referrer: '' });
    }

    // 2. Crawl until target reached or queue empty
    const maxSubs = this.config.maxSubrequests;
    while (
      this.currentTokens < this.config.targetTokens &&
      this.queue.length > 0 &&
      this.loadedContent.length < this.config.maxPages &&
      (maxSubs === undefined || this.subrequestCount < maxSubs)
    ) {
      // Sort by score (highest first)
      this.queue.sort((a, b) => b.score - a.score);
      const next = this.queue.shift()!;

      if (this.visited.has(next.url)) continue;
      this.visited.add(next.url);

      // Check robots.txt (counts as subrequest)
      if (this.config.respectRobotsTxt) {
        const allowed = await this.checkRobots(next.url);
        if (!allowed) {
          this.errors.push({
            url: next.url,
            error: 'Blocked by robots.txt',
            timestamp: new Date(),
          });
          continue;
        }
      }

      try {
        const result = await this.loadPage(next.url);
        this.subrequestCount++;

        if (result.tokenEstimate >= this.config.minTokensPerPage) {
          this.loadedContent.push(result);
          this.currentTokens += result.tokenEstimate;

          // Extract and queue links
          if (result.links) {
            this.queueLinks(result.links, next.url, next.depth);
          }
        }
      } catch (error) {
        this.errors.push({
          url: next.url,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        });
      }

      // Rate limiting
      if (this.queue.length > 0) {
        await this.delay(this.config.delayMs);
      }
    }

    // 3. Combine results
    return this.buildResult();
  }

  /**
   * Load a single page
   */
  private async loadPage(url: string): Promise<LoadedPage> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'text/plain';
    const buffer = Buffer.from(await response.arrayBuffer());

    const extractor =
      this.extractorRegistry.findForMimeType(contentType) ??
      this.extractorRegistry.getDefault();

    const extracted = await extractor.extract(buffer, url);
    const tokenEstimate = this.estimateTokens(extracted.text);

    return {
      path: url,
      content: extracted.text,
      size: buffer.length,
      tokenEstimate,
      links: extracted.links,
      mimeType: contentType.split(';')[0].trim(),
      metadata: {
        title: extracted.title,
        ...extracted.metadata,
      },
    };
  }

  /**
   * Queue links found on a page
   */
  private queueLinks(links: string[], sourceUrl: string, sourceDepth: number): void {
    const sourceOrigin = new URL(sourceUrl).origin;

    for (const link of links) {
      if (shouldSkipUrl(link)) continue;

      try {
        const resolved = normalizeUrl(new URL(link, sourceUrl).href);

        // Skip if already visited or queued
        if (this.visited.has(resolved)) continue;
        if (this.queue.some((q) => q.url === resolved)) continue;

        // Skip external if sameDomainOnly
        const linkOrigin = new URL(resolved).origin;
        if (this.config.sameDomainOnly && linkOrigin !== sourceOrigin) continue;

        // Score the link
        const score = scoreLink(resolved, sourceUrl);

        // Skip low-scoring links
        if (score < 20) continue;

        this.queue.push({
          url: resolved,
          score,
          depth: sourceDepth + 1,
          referrer: sourceUrl,
        });
      } catch {
        // Invalid URL, skip
      }
    }
  }

  /**
   * Check robots.txt for a URL
   */
  private async checkRobots(url: string): Promise<boolean> {
    const origin = new URL(url).origin;

    if (!this.robotsCache.has(origin)) {
      const checker = new RobotsChecker(origin, this.userAgent);
      await checker.load();
      this.robotsCache.set(origin, checker);
    }

    return this.robotsCache.get(origin)!.isAllowed(url);
  }

  /**
   * Estimate tokens for text content
   * Uses rough approximation: ~4 chars per token for English
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Delay for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Build the final LoadedSource result
   */
  private buildResult(): LoadedSource {
    const content = this.loadedContent
      .map((f) => {
        const title = (f.metadata?.title as string) || f.path;
        return `# ${title}\nSource: ${f.path}\n\n${f.content}\n\n---\n`;
      })
      .join('\n');

    // Convert LoadedPage to FileInfo (strip links)
    const files: FileInfo[] = this.loadedContent.map((p) => ({
      path: p.path,
      content: p.content,
      size: p.size,
      tokenEstimate: p.tokenEstimate,
      mimeType: p.mimeType,
    }));

    return {
      content,
      totalTokens: this.currentTokens,
      fileCount: this.loadedContent.length,
      files,
      metadata: {
        source: this.config.seedUrls.join(' + '),
        loadedAt: new Date(),
        pagesLoaded: this.loadedContent.length,
        pagesSkipped: this.visited.size - this.loadedContent.length,
        pagesInQueue: this.queue.length,
        errors: this.errors.length > 0 ? this.errors : undefined,
        targetTokens: this.config.targetTokens,
        actualTokens: this.currentTokens,
        crawlConfig: {
          sameDomainOnly: this.config.sameDomainOnly,
          maxPages: this.config.maxPages,
          minTokensPerPage: this.config.minTokensPerPage,
          maxSubrequests: this.config.maxSubrequests,
        },
        subrequestsUsed: this.subrequestCount,
        stoppedBySubrequestLimit: this.config.maxSubrequests !== undefined &&
          this.subrequestCount >= this.config.maxSubrequests,
      },
    };
  }
}
