/**
 * HTML content extractor
 * Uses @mozilla/readability for article extraction with cheerio fallback
 */

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';
import type { ContentExtractor, ExtractedContent } from './types';

/**
 * Extracts readable text content from HTML pages
 * Attempts Readability first for article-style content,
 * falls back to cheerio tag stripping for other pages
 */
export class HtmlExtractor implements ContentExtractor {
  readonly name = 'html';
  readonly mimeTypes = ['text/html', 'application/xhtml+xml'];

  /**
   * Extract text content from HTML
   * @param content - Raw HTML buffer
   * @param url - Source URL for resolving relative links
   */
  async extract(content: Buffer, url: string): Promise<ExtractedContent> {
    const html = content.toString('utf-8');

    // Try Readability first (best for articles, docs, blogs)
    try {
      const result = this.extractWithReadability(html, url);
      if (result.text.length > 100) {
        return result;
      }
    } catch {
      // Fall through to cheerio
    }

    // Fallback to cheerio tag stripping
    return this.extractWithCheerio(html, url);
  }

  /**
   * Extract using Mozilla Readability
   * Best for article-style content with clear main content area
   */
  private extractWithReadability(html: string, url: string): ExtractedContent {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      throw new Error('Readability failed to parse');
    }

    // Extract links from original HTML
    const links = this.extractLinks(html, url);

    return {
      text: article.textContent,
      title: article.title,
      links,
      metadata: {
        author: article.byline || undefined,
        excerpt: article.excerpt,
        siteName: article.siteName || undefined,
      },
    };
  }

  /**
   * Extract using Cheerio (simple tag stripping)
   * Fallback for pages where Readability fails
   */
  private extractWithCheerio(html: string, url: string): ExtractedContent {
    const $ = cheerio.load(html);

    // Remove non-content elements
    $('script, style, nav, header, footer, aside, iframe, noscript, svg').remove();
    $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();
    $('.nav, .navigation, .menu, .sidebar, .footer, .header, .ad, .ads, .advertisement').remove();

    // Extract title
    const title = $('title').text().trim() || $('h1').first().text().trim() || undefined;

    // Extract links before getting text
    const links = this.extractLinks(html, url);

    // Get text content from body
    const text = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    // Extract metadata
    const description = $('meta[name="description"]').attr('content');
    const author = $('meta[name="author"]').attr('content');
    const publishedDate = $('meta[property="article:published_time"]').attr('content');

    return {
      text,
      title,
      links,
      metadata: {
        description: description || undefined,
        author: author || undefined,
        publishedDate: publishedDate || undefined,
      },
    };
  }

  /**
   * Extract all links from HTML
   * @param html - HTML content
   * @param baseUrl - Base URL for resolving relative links
   */
  private extractLinks(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const links: string[] = [];

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
        try {
          const resolved = new URL(href, baseUrl).href;
          if (resolved.startsWith('http')) {
            links.push(resolved);
          }
        } catch {
          // Invalid URL, skip
        }
      }
    });

    return [...new Set(links)]; // Dedupe
  }
}
