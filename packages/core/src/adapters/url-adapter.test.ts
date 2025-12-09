/**
 * Tests for UrlAdapter
 */

import { describe, test, expect } from 'bun:test';
import { UrlAdapter, isGenericUrl } from './url-adapter';

describe('UrlAdapter', () => {
  const adapter = new UrlAdapter();

  test('has correct type and name', () => {
    expect(adapter.type).toBe('url');
    expect(adapter.name).toBe('URL Loader');
  });

  describe('canHandle', () => {
    test('handles explicit url type configs', () => {
      expect(adapter.canHandle({ type: 'url', url: 'https://example.com' })).toBe(true);
      expect(adapter.canHandle({ type: 'url' })).toBe(false); // No URL
    });

    test('handles generic HTTP URLs', () => {
      expect(
        adapter.canHandle({ type: 'generic', url: 'https://docs.example.com/guide' })
      ).toBe(true);
      expect(adapter.canHandle({ type: 'generic', url: 'http://example.com' })).toBe(true);
    });

    test('does not handle GitHub URLs', () => {
      expect(
        adapter.canHandle({ type: 'generic', url: 'https://github.com/owner/repo' })
      ).toBe(false);
    });

    test('does not handle non-HTTP URLs', () => {
      expect(adapter.canHandle({ type: 'generic', url: 'ftp://example.com' })).toBe(false);
      expect(adapter.canHandle({ type: 'generic', url: '/local/path' })).toBe(false);
    });
  });

  describe('load validation', () => {
    test('throws on missing URL', async () => {
      await expect(adapter.load({ type: 'url' })).rejects.toThrow('No URL provided');
    });

    test('throws on invalid URL format', async () => {
      await expect(
        adapter.load({ type: 'url', url: 'not-a-url' })
      ).rejects.toThrow('Invalid URL format');
    });

    test('throws on non-HTTP URL', async () => {
      await expect(
        adapter.load({ type: 'url', url: 'ftp://example.com/file' })
      ).rejects.toThrow(); // Throws either Invalid URL format or Only HTTP/HTTPS
    });
  });
});

describe('isGenericUrl', () => {
  test('returns true for HTTP/HTTPS non-GitHub URLs', () => {
    expect(isGenericUrl('https://docs.example.com/')).toBe(true);
    expect(isGenericUrl('http://example.com/page')).toBe(true);
    expect(isGenericUrl('https://developer.mozilla.org/en-US/docs/')).toBe(true);
  });

  test('returns false for GitHub URLs', () => {
    expect(isGenericUrl('https://github.com/owner/repo')).toBe(false);
    expect(isGenericUrl('https://github.com/')).toBe(false);
    // Note: raw.githubusercontent.com is technically not github.com, so it's treated as generic
    // This is acceptable behavior - the main github.com domain is what we want to exclude
  });

  test('returns false for non-HTTP URLs', () => {
    expect(isGenericUrl('ftp://example.com')).toBe(false);
    expect(isGenericUrl('/local/path')).toBe(false);
    expect(isGenericUrl('./relative/path')).toBe(false);
  });

  test('returns false for invalid URLs', () => {
    expect(isGenericUrl('not a url')).toBe(false);
    expect(isGenericUrl('')).toBe(false);
  });
});
