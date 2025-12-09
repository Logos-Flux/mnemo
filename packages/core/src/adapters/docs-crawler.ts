/**
 * Documentation site crawler adapter
 * Crawls and loads content from documentation websites
 */

import type { LoadedSource, FileInfo } from '../types';
import { LoadError, TokenLimitError } from '../types';
import type { SourceAdapter, SourceConfig, AdapterLoadOptions } from './base';

export interface DocsCrawlerConfig extends SourceConfig {
  type: 'docs';
  url: string;
  maxDepth?: number;
  followExternal?: boolean;
}

/**
 * Adapter for crawling documentation websites
 * Recursively fetches pages and extracts content
 */
export class DocsCrawlerAdapter implements SourceAdapter {
  readonly type = 'docs';
  readonly name = 'Documentation Crawler';

  private maxTokens: number;
  private visited = new Set<string>();

  constructor(maxTokens: number = 900000) {
    this.maxTokens = maxTokens;
  }

  canHandle(source: SourceConfig): boolean {
    return source.type === 'docs' && !!source.url;
  }

  async load(source: SourceConfig, options?: AdapterLoadOptions): Promise<LoadedSource> {
    const config = source as DocsCrawlerConfig;
    const maxDepth = config.maxDepth ?? 3;
    const followExternal = config.followExternal ?? false;
    const maxTokens = options?.maxTokens ?? this.maxTokens;

    // Reset visited set for new load
    this.visited.clear();

    try {
      const startUrl = new URL(config.url);
      const files: FileInfo[] = [];

      await this.crawlUrl(startUrl, startUrl.origin, maxDepth, 0, files, followExternal);

      const totalTokens = files.reduce((sum, f) => sum + f.tokenEstimate, 0);

      if (totalTokens > maxTokens) {
        throw new TokenLimitError(totalTokens, maxTokens);
      }

      // Combine all page contents
      const content = files.map(f => {
        return `# ${f.path}\n\n${f.content}\n\n---\n`;
      }).join('\n');

      return {
        content,
        totalTokens,
        fileCount: files.length,
        files,
        metadata: {
          source: config.url,
          loadedAt: new Date(),
          baseUrl: startUrl.origin,
          pagesCount: files.length,
          maxDepth,
        },
      };
    } catch (error) {
      if (error instanceof TokenLimitError) {
        throw error;
      }
      throw new LoadError(config.url, `Failed to crawl documentation: ${(error as Error).message}`);
    }
  }

  /**
   * Recursively crawl a URL and extract content
   */
  private async crawlUrl(
    url: URL,
    baseOrigin: string,
    maxDepth: number,
    currentDepth: number,
    files: FileInfo[],
    followExternal: boolean
  ): Promise<void> {
    // Skip if already visited or depth exceeded
    if (this.visited.has(url.href) || currentDepth > maxDepth) {
      return;
    }

    // Skip if external and not following external links
    if (!followExternal && url.origin !== baseOrigin) {
      return;
    }

    this.visited.add(url.href);

    try {
      const response = await fetch(url.href);
      if (!response.ok) {
        console.warn(`Failed to fetch ${url.href}: ${response.status}`);
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return; // Skip non-HTML content
      }

      const html = await response.text();
      const content = this.extractContent(html);
      const tokenEstimate = this.estimateTokens(content);

      files.push({
        path: url.pathname,
        content,
        size: Buffer.byteLength(content, 'utf-8'),
        tokenEstimate,
      });

      // Extract and crawl links if not at max depth
      if (currentDepth < maxDepth) {
        const links = this.extractLinks(html, url);

        // Crawl links sequentially to avoid overwhelming the server
        for (const link of links) {
          await this.crawlUrl(link, baseOrigin, maxDepth, currentDepth + 1, files, followExternal);

          // Add small delay to be respectful to the server
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch (error) {
      console.warn(`Error crawling ${url.href}:`, error);
    }
  }

  /**
   * Extract main content from HTML
   * Removes scripts, styles, nav, and other non-content elements
   */
  private extractContent(html: string): string {
    // Remove script and style tags
    let content = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Remove common non-content elements
    content = content.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
    content = content.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '');
    content = content.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');
    content = content.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '');

    // Remove HTML tags
    content = content.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    content = content.replace(/&nbsp;/g, ' ');
    content = content.replace(/&lt;/g, '<');
    content = content.replace(/&gt;/g, '>');
    content = content.replace(/&amp;/g, '&');
    content = content.replace(/&quot;/g, '"');
    content = content.replace(/&#39;/g, "'");

    // Clean up whitespace
    content = content.replace(/\s+/g, ' ');
    content = content.trim();

    return content;
  }

  /**
   * Extract links from HTML
   */
  private extractLinks(html: string, baseUrl: URL): URL[] {
    const links: URL[] = [];
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      try {
        const href = match[2];

        // Skip anchors, mailto, tel, javascript, etc.
        if (href.startsWith('#') || href.startsWith('mailto:') ||
            href.startsWith('tel:') || href.startsWith('javascript:')) {
          continue;
        }

        // Resolve relative URLs
        const absoluteUrl = new URL(href, baseUrl);
        links.push(absoluteUrl);
      } catch {
        // Invalid URL, skip
      }
    }

    return links;
  }

  /**
   * Estimate token count for content
   * Rough estimate: ~4 characters per token
   */
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }
}
