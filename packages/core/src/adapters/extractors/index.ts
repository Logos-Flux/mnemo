/**
 * Content extractors for various MIME types
 */

export * from './types';
export * from './html-extractor';
export * from './pdf-extractor';
export * from './json-extractor';
export * from './text-extractor';

import { ExtractorRegistry } from './types';
import { HtmlExtractor } from './html-extractor';
import { PdfExtractor } from './pdf-extractor';
import { JsonExtractor } from './json-extractor';
import { TextExtractor } from './text-extractor';

/**
 * Create a registry with all default extractors
 * @returns Configured ExtractorRegistry
 */
export function createDefaultRegistry(): ExtractorRegistry {
  const registry = new ExtractorRegistry();

  registry.register(new HtmlExtractor());
  registry.register(new PdfExtractor());
  registry.register(new JsonExtractor());

  // Text extractor is also the default fallback
  const textExtractor = new TextExtractor();
  registry.register(textExtractor);
  registry.setDefault(textExtractor);

  return registry;
}
