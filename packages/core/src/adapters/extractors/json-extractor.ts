/**
 * JSON content extractor
 * Pretty-prints JSON with structure summary for LLM context
 */

import type { ContentExtractor, ExtractedContent } from './types';

/**
 * Extracts and formats JSON content for LLM consumption
 * Adds structure summary to help LLM understand the data shape
 */
export class JsonExtractor implements ContentExtractor {
  readonly name = 'json';
  readonly mimeTypes = ['application/json', 'text/json'];

  /**
   * Extract and format JSON content
   * @param content - Raw JSON buffer
   * @param url - Source URL
   */
  async extract(content: Buffer, url: string): Promise<ExtractedContent> {
    const text = content.toString('utf-8');

    try {
      const parsed = JSON.parse(text);

      // Pretty print for readability
      const prettyJson = JSON.stringify(parsed, null, 2);

      // Generate structure summary
      const summary = this.summarizeStructure(parsed);

      // Build output with summary header
      const fullText = [
        '## JSON Structure Summary',
        summary,
        '',
        '## Content',
        '```json',
        prettyJson,
        '```',
      ].join('\n');

      return {
        text: fullText,
        title: this.extractTitle(parsed, url),
        metadata: {
          type: Array.isArray(parsed) ? 'array' : 'object',
          topLevelKeys: Array.isArray(parsed) ? undefined : Object.keys(parsed),
          arrayLength: Array.isArray(parsed) ? parsed.length : undefined,
        },
      };
    } catch (error) {
      // If JSON is invalid, return raw text
      return {
        text: `[Invalid JSON]\n${text}`,
        title: this.extractTitleFromUrl(url),
        metadata: {
          error: error instanceof Error ? error.message : 'Parse error',
        },
      };
    }
  }

  /**
   * Generate a human-readable structure summary
   */
  private summarizeStructure(obj: unknown, depth = 0, maxDepth = 2): string {
    if (depth > maxDepth) return '...';

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      const itemSummary = this.summarizeStructure(obj[0], depth + 1, maxDepth);
      return `Array[${obj.length}] of ${itemSummary}`;
    }

    if (obj && typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) return '{}';
      if (depth === maxDepth) return `{${keys.join(', ')}}`;

      const entries = keys.slice(0, 5).map((k) => {
        const val = (obj as Record<string, unknown>)[k];
        return `${k}: ${this.summarizeStructure(val, depth + 1, maxDepth)}`;
      });
      if (keys.length > 5) entries.push(`... +${keys.length - 5} more keys`);
      return `{ ${entries.join(', ')} }`;
    }

    if (typeof obj === 'string') {
      return obj.length > 50 ? `string(${obj.length} chars)` : `"${obj}"`;
    }

    return typeof obj;
  }

  /**
   * Extract title from JSON content or URL
   */
  private extractTitle(parsed: unknown, url: string): string {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.title === 'string') return obj.title;
      if (typeof obj.name === 'string') return obj.name;
      if (typeof obj.id === 'string') return `ID: ${obj.id}`;
    }
    return this.extractTitleFromUrl(url);
  }

  /**
   * Extract title from URL path
   */
  private extractTitleFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').filter(Boolean).pop() || 'JSON Data';
    } catch {
      return 'JSON Data';
    }
  }
}
