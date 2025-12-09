/**
 * PDF content extractor
 * Uses unpdf for Workers-compatible PDF text extraction
 */

import { extractText } from 'unpdf';
import type { ContentExtractor, ExtractedContent } from './types';

/**
 * Extracts text content from PDF documents
 * Uses unpdf which works in both Node.js and Cloudflare Workers environments
 */
export class PdfExtractor implements ContentExtractor {
  readonly name = 'pdf';
  readonly mimeTypes = ['application/pdf'];

  /**
   * Extract text content from PDF
   * @param content - Raw PDF buffer
   * @param url - Source URL (used for title fallback)
   */
  async extract(content: Buffer, url: string): Promise<ExtractedContent> {
    try {
      // Convert Buffer to Uint8Array for unpdf
      const uint8Array = new Uint8Array(content);
      // Use mergePages: true to get a single string instead of array per page
      const result = await extractText(uint8Array, { mergePages: true });

      // Extract title from URL since unpdf doesn't provide metadata
      const title = this.extractTitleFromUrl(url);

      return {
        text: result.text,
        title,
        metadata: {
          pageCount: result.totalPages,
        },
      };
    } catch (error) {
      throw new Error(
        `Failed to parse PDF: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Extract a reasonable title from URL path
   */
  private extractTitleFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split('/').pop() || pathname;
      // Remove .pdf extension and clean up
      return filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
    } catch {
      return 'PDF Document';
    }
  }
}
