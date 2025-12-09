/**
 * Plain text content extractor
 * Passthrough for text content types
 */

import type { ContentExtractor, ExtractedContent } from './types';

/**
 * Passthrough extractor for plain text and markdown content
 * Used as default fallback for unknown content types
 */
export class TextExtractor implements ContentExtractor {
  readonly name = 'text';
  readonly mimeTypes = ['text/plain', 'text/markdown', 'text/csv', 'text/xml'];

  /**
   * Extract text content (passthrough)
   * @param content - Raw text buffer
   * @param url - Source URL
   */
  async extract(content: Buffer, url: string): Promise<ExtractedContent> {
    const text = content.toString('utf-8');

    return {
      text,
      title: this.extractTitleFromUrl(url),
      metadata: {
        charCount: text.length,
        lineCount: text.split('\n').length,
      },
    };
  }

  /**
   * Extract title from URL path
   */
  private extractTitleFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').filter(Boolean).pop() || url;
    } catch {
      return url;
    }
  }
}
