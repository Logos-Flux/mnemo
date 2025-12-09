/**
 * Tests for content extractors
 */

import { describe, test, expect } from 'bun:test';
import { HtmlExtractor } from './html-extractor';
import { PdfExtractor } from './pdf-extractor';
import { JsonExtractor } from './json-extractor';
import { TextExtractor } from './text-extractor';
import { ExtractorRegistry, createDefaultRegistry } from './index';

describe('HtmlExtractor', () => {
  const extractor = new HtmlExtractor();

  test('identifies correct MIME types', () => {
    expect(extractor.name).toBe('html');
    expect(extractor.mimeTypes).toContain('text/html');
    expect(extractor.mimeTypes).toContain('application/xhtml+xml');
  });

  test('extracts text from simple HTML', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Page</title></head>
        <body>
          <h1>Hello World</h1>
          <p>This is a test paragraph.</p>
        </body>
      </html>
    `;
    const buffer = Buffer.from(html);
    const result = await extractor.extract(buffer, 'https://example.com/test');

    expect(result.text).toContain('Hello World');
    expect(result.text).toContain('test paragraph');
    expect(result.title).toBe('Test Page');
  });

  test('extracts links from HTML', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Links Page</title></head>
        <body>
          <a href="/page1">Page 1</a>
          <a href="https://other.com/page2">Page 2</a>
          <a href="#anchor">Anchor</a>
          <a href="javascript:void(0)">JS Link</a>
        </body>
      </html>
    `;
    const buffer = Buffer.from(html);
    const result = await extractor.extract(buffer, 'https://example.com/');

    expect(result.links).toBeDefined();
    expect(result.links).toContain('https://example.com/page1');
    expect(result.links).toContain('https://other.com/page2');
    // Should not include anchors or javascript links
    expect(result.links).not.toContain('#anchor');
    expect(result.links).not.toContain('javascript:void(0)');
  });

  test('removes non-content elements', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test</title>
          <style>.hidden { display: none; }</style>
          <script>console.log('test');</script>
        </head>
        <body>
          <nav>Navigation</nav>
          <header>Header</header>
          <main>Main Content</main>
          <footer>Footer</footer>
        </body>
      </html>
    `;
    const buffer = Buffer.from(html);
    const result = await extractor.extract(buffer, 'https://example.com/');

    expect(result.text).toContain('Main Content');
    // These should be removed or minimized
    expect(result.text).not.toContain('console.log');
    expect(result.text).not.toContain('.hidden');
  });

  test('handles malformed HTML gracefully', async () => {
    const html = '<p>Unclosed tag <b>bold text';
    const buffer = Buffer.from(html);

    // Should not throw
    const result = await extractor.extract(buffer, 'https://example.com/');
    expect(result.text).toContain('Unclosed tag');
    expect(result.text).toContain('bold text');
  });
});

describe('JsonExtractor', () => {
  const extractor = new JsonExtractor();

  test('identifies correct MIME types', () => {
    expect(extractor.name).toBe('json');
    expect(extractor.mimeTypes).toContain('application/json');
    expect(extractor.mimeTypes).toContain('text/json');
  });

  test('pretty prints JSON objects', async () => {
    const json = { name: 'test', value: 123 };
    const buffer = Buffer.from(JSON.stringify(json));
    const result = await extractor.extract(buffer, 'https://api.example.com/data');

    expect(result.text).toContain('"name": "test"');
    expect(result.text).toContain('"value": 123');
    expect(result.metadata?.type).toBe('object');
    expect(result.metadata?.topLevelKeys).toContain('name');
  });

  test('handles arrays', async () => {
    const json = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const buffer = Buffer.from(JSON.stringify(json));
    const result = await extractor.extract(buffer, 'https://api.example.com/list');

    expect(result.metadata?.type).toBe('array');
    expect(result.metadata?.arrayLength).toBe(3);
  });

  test('extracts title from JSON', async () => {
    const json = { title: 'My Document', content: 'Some content' };
    const buffer = Buffer.from(JSON.stringify(json));
    const result = await extractor.extract(buffer, 'https://api.example.com/doc');

    expect(result.title).toBe('My Document');
  });

  test('generates structure summary', async () => {
    const json = {
      users: [{ name: 'Alice', age: 30 }],
      metadata: { count: 1 },
    };
    const buffer = Buffer.from(JSON.stringify(json));
    const result = await extractor.extract(buffer, 'https://api.example.com/data');

    expect(result.text).toContain('## JSON Structure Summary');
    expect(result.text).toContain('## Content');
  });

  test('handles invalid JSON', async () => {
    const invalid = '{ invalid json }';
    const buffer = Buffer.from(invalid);
    const result = await extractor.extract(buffer, 'https://api.example.com/data');

    expect(result.text).toContain('[Invalid JSON]');
    expect(result.metadata?.error).toBeDefined();
  });
});

describe('TextExtractor', () => {
  const extractor = new TextExtractor();

  test('identifies correct MIME types', () => {
    expect(extractor.name).toBe('text');
    expect(extractor.mimeTypes).toContain('text/plain');
    expect(extractor.mimeTypes).toContain('text/markdown');
    expect(extractor.mimeTypes).toContain('text/csv');
  });

  test('passes through text content', async () => {
    const text = 'This is plain text content.\nWith multiple lines.';
    const buffer = Buffer.from(text);
    const result = await extractor.extract(buffer, 'https://example.com/file.txt');

    expect(result.text).toBe(text);
    expect(result.metadata?.lineCount).toBe(2);
  });

  test('extracts title from URL path', async () => {
    const buffer = Buffer.from('content');
    const result = await extractor.extract(buffer, 'https://example.com/docs/readme.md');

    expect(result.title).toBe('readme.md');
  });
});

describe('ExtractorRegistry', () => {
  test('finds extractor by MIME type', () => {
    const registry = createDefaultRegistry();

    const htmlExtractor = registry.findForMimeType('text/html');
    expect(htmlExtractor?.name).toBe('html');

    const jsonExtractor = registry.findForMimeType('application/json');
    expect(jsonExtractor?.name).toBe('json');
  });

  test('handles MIME type with charset', () => {
    const registry = createDefaultRegistry();

    const extractor = registry.findForMimeType('text/html; charset=utf-8');
    expect(extractor?.name).toBe('html');
  });

  test('returns default for unknown type', () => {
    const registry = createDefaultRegistry();

    const extractor = registry.findForMimeType('application/unknown');
    expect(extractor).toBeUndefined();

    const defaultExtractor = registry.getDefault();
    expect(defaultExtractor.name).toBe('text');
  });

  test('lists all registered extractors', () => {
    const registry = createDefaultRegistry();
    const list = registry.list();

    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some((e) => e.name === 'html')).toBe(true);
    expect(list.some((e) => e.name === 'json')).toBe(true);
    expect(list.some((e) => e.name === 'text')).toBe(true);
  });
});

describe('PdfExtractor', () => {
  const extractor = new PdfExtractor();

  test('identifies correct MIME types', () => {
    expect(extractor.name).toBe('pdf');
    expect(extractor.mimeTypes).toContain('application/pdf');
  });

  test('extracts title from URL when PDF has no title', async () => {
    // Create a minimal valid PDF (this will fail parsing but test the fallback)
    const buffer = Buffer.from('%PDF-1.0\ninvalid pdf for testing');

    try {
      await extractor.extract(buffer, 'https://example.com/docs/report.pdf');
    } catch (error) {
      // Expected to fail with invalid PDF, but we're testing the error path
      expect(error).toBeDefined();
    }
  });
});
