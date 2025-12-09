/**
 * Tests for URL adapter components
 */

import { describe, test, expect } from 'bun:test';
import { RobotsChecker } from './robots';
import { scoreLink, shouldSkipUrl, normalizeUrl } from './link-scorer';

describe('RobotsChecker', () => {
  test('allows all URLs when no robots.txt loaded', () => {
    const checker = new RobotsChecker('https://example.com', 'TestBot/1.0');
    // Not loaded yet, should allow all
    expect(checker.isAllowed('https://example.com/page')).toBe(true);
  });
});

describe('Link Scorer', () => {
  describe('scoreLink', () => {
    test('boosts same-domain links', () => {
      const sameDomain = scoreLink(
        'https://example.com/page2',
        'https://example.com/page1'
      );
      const differentDomain = scoreLink(
        'https://other.com/page',
        'https://example.com/page1'
      );

      expect(sameDomain).toBeGreaterThan(differentDomain);
    });

    test('boosts documentation paths', () => {
      const docsPath = scoreLink(
        'https://example.com/docs/guide',
        'https://example.com/'
      );
      const regularPath = scoreLink(
        'https://example.com/about',
        'https://example.com/'
      );

      expect(docsPath).toBeGreaterThan(regularPath);
    });

    test('penalizes login/auth paths', () => {
      const loginPath = scoreLink(
        'https://example.com/login',
        'https://example.com/'
      );
      const regularPath = scoreLink(
        'https://example.com/about',
        'https://example.com/'
      );

      expect(loginPath).toBeLessThan(regularPath);
    });

    test('penalizes anchors to same page', () => {
      const anchor = scoreLink(
        'https://example.com/page#section',
        'https://example.com/page'
      );
      const differentPage = scoreLink(
        'https://example.com/other',
        'https://example.com/page'
      );

      expect(anchor).toBeLessThan(differentPage);
    });

    test('penalizes download files', () => {
      const zipFile = scoreLink(
        'https://example.com/file.zip',
        'https://example.com/'
      );
      const htmlPage = scoreLink(
        'https://example.com/page.html',
        'https://example.com/'
      );

      expect(zipFile).toBeLessThan(htmlPage);
    });

    test('handles invalid URLs gracefully', () => {
      const score = scoreLink('not-a-url', 'https://example.com/');
      expect(score).toBe(10); // Low score for invalid
    });
  });

  describe('shouldSkipUrl', () => {
    test('skips non-HTTP protocols', () => {
      expect(shouldSkipUrl('ftp://example.com/file')).toBe(true);
      expect(shouldSkipUrl('mailto:test@example.com')).toBe(true);
      expect(shouldSkipUrl('javascript:void(0)')).toBe(true);
    });

    test('allows HTTP/HTTPS', () => {
      expect(shouldSkipUrl('http://example.com/')).toBe(false);
      expect(shouldSkipUrl('https://example.com/')).toBe(false);
    });

    test('skips static asset paths', () => {
      expect(shouldSkipUrl('https://example.com/static/image.png')).toBe(true);
      expect(shouldSkipUrl('https://example.com/_next/data.json')).toBe(true);
      expect(shouldSkipUrl('https://example.com/node_modules/package/index.js')).toBe(true);
    });

    test('skips invalid URLs', () => {
      expect(shouldSkipUrl('not a url')).toBe(true);
    });
  });

  describe('normalizeUrl', () => {
    test('removes tracking parameters', () => {
      const url = normalizeUrl(
        'https://example.com/page?utm_source=twitter&utm_campaign=launch&id=123'
      );
      expect(url).toBe('https://example.com/page?id=123');
    });

    test('removes hash/anchor', () => {
      const url = normalizeUrl('https://example.com/page#section');
      expect(url).toBe('https://example.com/page');
    });

    test('normalizes trailing slashes', () => {
      const url = normalizeUrl('https://example.com/docs/');
      expect(url).toBe('https://example.com/docs');
    });

    test('preserves file extensions', () => {
      const url = normalizeUrl('https://example.com/docs/guide.html');
      expect(url).toBe('https://example.com/docs/guide.html');
    });

    test('handles invalid URLs gracefully', () => {
      const url = normalizeUrl('not-a-url');
      expect(url).toBe('not-a-url');
    });
  });
});
