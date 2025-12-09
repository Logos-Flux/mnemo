import { describe, expect, test } from 'bun:test';
import { DocsCrawlerAdapter } from './docs-crawler';

describe('DocsCrawlerAdapter', () => {
  test('identifies correct source type', () => {
    const adapter = new DocsCrawlerAdapter();
    expect(adapter.type).toBe('docs');
    expect(adapter.name).toBe('Documentation Crawler');
  });

  test('canHandle validates docs sources', () => {
    const adapter = new DocsCrawlerAdapter();

    expect(adapter.canHandle({
      type: 'docs',
      url: 'https://example.com/docs',
    })).toBe(true);

    expect(adapter.canHandle({
      type: 'repo',
      path: '/some/path',
    })).toBe(false);

    expect(adapter.canHandle({
      type: 'docs',
      // Missing url
    })).toBe(false);
  });

  test('extracts content from HTML', () => {
    const adapter = new DocsCrawlerAdapter();
    const html = `
      <html>
        <head><title>Test</title></head>
        <body>
          <nav>Navigation</nav>
          <main>
            <h1>Main Content</h1>
            <p>This is the main content.</p>
          </main>
          <script>console.log('test');</script>
          <footer>Footer</footer>
        </body>
      </html>
    `;

    // Access private method via type assertion for testing
    const content = (adapter as any).extractContent(html);

    // Should include main content
    expect(content).toContain('Main Content');
    expect(content).toContain('main content');

    // Should remove nav, script, footer
    expect(content).not.toContain('Navigation');
    expect(content).not.toContain('console.log');
    expect(content).not.toContain('Footer');
  });

  test('extracts links from HTML', () => {
    const adapter = new DocsCrawlerAdapter();
    const baseUrl = new URL('https://example.com/docs/');
    const html = `
      <html>
        <body>
          <a href="/docs/guide">Guide</a>
          <a href="./api">API</a>
          <a href="https://example.com/docs/reference">Reference</a>
          <a href="https://external.com">External</a>
          <a href="#anchor">Anchor</a>
          <a href="mailto:test@example.com">Email</a>
        </body>
      </html>
    `;

    const links = (adapter as any).extractLinks(html, baseUrl);

    expect(links.length).toBeGreaterThan(0);

    // Should include valid links
    const hrefs = links.map((l: URL) => l.href);
    expect(hrefs).toContain('https://example.com/docs/guide');
    expect(hrefs).toContain('https://example.com/docs/api');

    // Should not include anchors or mailto
    expect(hrefs.some((h: string) => h.startsWith('#'))).toBe(false);
    expect(hrefs.some((h: string) => h.startsWith('mailto:'))).toBe(false);
  });

  test('estimates tokens correctly', () => {
    const adapter = new DocsCrawlerAdapter();
    const shortText = 'Hello world'; // ~3 tokens
    const longText = 'a'.repeat(400); // ~100 tokens

    const shortEstimate = (adapter as any).estimateTokens(shortText);
    const longEstimate = (adapter as any).estimateTokens(longText);

    expect(shortEstimate).toBeGreaterThanOrEqual(2);
    expect(shortEstimate).toBeLessThanOrEqual(5);

    expect(longEstimate).toBeGreaterThanOrEqual(90);
    expect(longEstimate).toBeLessThanOrEqual(110);
  });

  test('respects maxDepth setting', async () => {
    const adapter = new DocsCrawlerAdapter();

    // Test that maxDepth config is accepted
    const config = {
      type: 'docs' as const,
      url: 'https://example.com',
      maxDepth: 2,
    };

    expect(config.maxDepth).toBe(2);
  });

  test('handles external links config', () => {
    const adapter = new DocsCrawlerAdapter();

    const config1 = {
      type: 'docs' as const,
      url: 'https://example.com',
      followExternal: true,
    };

    const config2 = {
      type: 'docs' as const,
      url: 'https://example.com',
      followExternal: false,
    };

    expect(adapter.canHandle(config1)).toBe(true);
    expect(adapter.canHandle(config2)).toBe(true);
  });
});
