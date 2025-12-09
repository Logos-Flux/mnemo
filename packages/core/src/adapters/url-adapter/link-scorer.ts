/**
 * Link scoring and prioritization for intelligent crawling
 */

/**
 * Score a link to prioritize which pages to crawl next
 * Higher scores = more likely to be useful content
 *
 * @param link - URL to score
 * @param sourceUrl - URL where the link was found
 * @returns Score from 0-100
 */
export function scoreLink(link: string, sourceUrl: string): number {
  let score = 50; // Base score

  try {
    const linkUrl = new URL(link);
    const sourceUrlObj = new URL(sourceUrl);

    // Same domain boost (prefer staying on same site)
    if (linkUrl.origin === sourceUrlObj.origin) {
      score += 20;
    }

    // Similar path prefix boost (stay in same section)
    const sourcePath = sourceUrlObj.pathname.split('/').slice(0, -1).join('/');
    if (sourcePath && linkUrl.pathname.startsWith(sourcePath)) {
      score += 10;
    }

    // Documentation-like paths boost
    const docPatterns = [
      '/docs',
      '/guide',
      '/reference',
      '/api',
      '/tutorial',
      '/learn',
      '/manual',
      '/handbook',
      '/help',
      '/faq',
      '/getting-started',
      '/quickstart',
    ];
    if (docPatterns.some((p) => linkUrl.pathname.toLowerCase().includes(p))) {
      score += 15;
    }

    // Penalize likely non-content pages
    const skipPatterns = [
      '/login',
      '/signup',
      '/auth',
      '/admin',
      '/cart',
      '/checkout',
      '/account',
      '/settings',
      '/profile',
      '/search',
      '/tag/',
      '/category/',
      '/author/',
      '/page/',
    ];
    if (skipPatterns.some((p) => linkUrl.pathname.toLowerCase().includes(p))) {
      score -= 30;
    }

    // Penalize anchors to same page
    if (linkUrl.pathname === sourceUrlObj.pathname && linkUrl.hash) {
      score -= 40;
    }

    // Penalize very long URLs (often pagination, filters, etc.)
    if (link.length > 200) {
      score -= 10;
    }

    // Penalize URLs with many query parameters
    const paramCount = linkUrl.searchParams.toString().split('&').length;
    if (paramCount > 3) {
      score -= 15;
    }

    // Boost for clean, short paths (likely main content)
    const pathDepth = linkUrl.pathname.split('/').filter(Boolean).length;
    if (pathDepth <= 3) {
      score += 5;
    }

    // Penalize file downloads that aren't useful content
    const skipExtensions = [
      '.zip',
      '.tar',
      '.gz',
      '.exe',
      '.dmg',
      '.pkg',
      '.deb',
      '.rpm',
      '.mp3',
      '.mp4',
      '.avi',
      '.mov',
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.svg',
      '.ico',
    ];
    const pathname = linkUrl.pathname.toLowerCase();
    if (skipExtensions.some((ext) => pathname.endsWith(ext))) {
      score -= 50;
    }

    // Boost for common documentation file extensions
    const docExtensions = ['.html', '.htm', '.md', '.txt'];
    if (docExtensions.some((ext) => pathname.endsWith(ext))) {
      score += 5;
    }
  } catch {
    // Invalid URL, low score
    score = 10;
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

/**
 * Check if a URL should be completely skipped (not even queued)
 * @param url - URL to check
 * @returns True if should be skipped
 */
export function shouldSkipUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);

    // Skip non-HTTP(S) protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return true;
    }

    // Skip common static asset paths
    const staticPaths = ['/static/', '/assets/', '/dist/', '/build/', '/_next/', '/node_modules/'];
    if (staticPaths.some((p) => urlObj.pathname.includes(p))) {
      return true;
    }

    // Skip URLs with common tracking parameters
    const trackingParams = ['utm_', 'ref=', 'source=', 'campaign='];
    const search = urlObj.search.toLowerCase();
    if (trackingParams.some((p) => search.includes(p))) {
      // Don't skip, but the URL will be normalized to remove these
      return false;
    }

    return false;
  } catch {
    return true; // Invalid URL, skip
  }
}

/**
 * Normalize a URL for deduplication
 * Removes tracking parameters and normalizes format
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Remove common tracking parameters
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'ref',
      'source',
      'campaign',
      'fbclid',
      'gclid',
    ];
    for (const param of trackingParams) {
      urlObj.searchParams.delete(param);
    }

    // Remove hash (anchor)
    urlObj.hash = '';

    // Ensure trailing slash consistency (remove for files, keep for directories)
    if (urlObj.pathname !== '/' && !urlObj.pathname.includes('.')) {
      urlObj.pathname = urlObj.pathname.replace(/\/$/, '');
    }

    return urlObj.href;
  } catch {
    return url;
  }
}
