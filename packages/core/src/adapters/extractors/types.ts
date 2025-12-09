/**
 * Types for content extractors
 * Extractors convert raw response data into text suitable for LLM context
 */

/**
 * Content extractor interface
 * Implementations extract text content from various MIME types
 */
export interface ContentExtractor {
  /** Unique identifier for this extractor */
  readonly name: string;

  /** MIME types this extractor handles */
  readonly mimeTypes: string[];

  /**
   * Extract text content from raw response
   * @param content - Raw response buffer
   * @param url - Source URL (for resolving relative links)
   * @returns Extracted content with metadata
   */
  extract(content: Buffer, url: string): Promise<ExtractedContent>;
}

/**
 * Result of content extraction
 */
export interface ExtractedContent {
  /** Extracted text content */
  text: string;

  /** Page/document title if available */
  title?: string;

  /** Links found in content (for crawling) */
  links?: string[];

  /** Additional metadata */
  metadata?: {
    author?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    [key: string]: unknown;
  };
}

/**
 * Registry for content extractors
 * Provides lookup by MIME type with fallback
 */
export class ExtractorRegistry {
  private extractors: ContentExtractor[] = [];
  private defaultExtractor: ContentExtractor | undefined;

  /**
   * Register an extractor
   * @param extractor - Extractor to register
   */
  register(extractor: ContentExtractor): void {
    this.extractors.push(extractor);
  }

  /**
   * Set the default fallback extractor
   * @param extractor - Default extractor for unknown types
   */
  setDefault(extractor: ContentExtractor): void {
    this.defaultExtractor = extractor;
  }

  /**
   * Find extractor for a MIME type
   * @param mimeType - Full MIME type string (may include charset)
   * @returns Matching extractor or undefined
   */
  findForMimeType(mimeType: string): ContentExtractor | undefined {
    // Normalize mime type (strip charset, parameters, etc.)
    const normalized = mimeType.split(';')[0].trim().toLowerCase();
    return this.extractors.find((e) =>
      e.mimeTypes.some((mt) => normalized.includes(mt))
    );
  }

  /**
   * Get the default fallback extractor
   * @returns Default extractor
   * @throws If no default is set
   */
  getDefault(): ContentExtractor {
    if (!this.defaultExtractor) {
      throw new Error('No default extractor registered');
    }
    return this.defaultExtractor;
  }

  /**
   * List all registered extractors
   */
  list(): ContentExtractor[] {
    return [...this.extractors];
  }
}
