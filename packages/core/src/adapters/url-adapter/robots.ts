/**
 * robots.txt parser and checker
 * Respects site crawling rules for good citizenship
 */

/**
 * Parsed robots.txt rule
 */
interface RobotsRule {
  userAgent: string;
  allow: string[];
  disallow: string[];
}

/**
 * Checker for robots.txt compliance
 * Caches and parses robots.txt files per origin
 */
export class RobotsChecker {
  private rules: RobotsRule[] = [];
  private loaded = false;

  constructor(
    private origin: string,
    private userAgent: string
  ) {}

  /**
   * Load and parse robots.txt from the origin
   * Safe to call multiple times (will only load once)
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const response = await fetch(`${this.origin}/robots.txt`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (response.ok) {
        const text = await response.text();
        this.rules = this.parse(text);
      }
      // If not ok, allow all (no robots.txt)
    } catch {
      // No robots.txt or fetch failed - allow all
    }
    this.loaded = true;
  }

  /**
   * Check if a URL is allowed to be crawled
   * @param url - Full URL to check
   * @returns True if allowed, false if disallowed
   */
  isAllowed(url: string): boolean {
    if (!this.loaded) return true;

    const pathname = new URL(url).pathname;

    // Find applicable rules (matching our user agent or *)
    const applicableRules = this.rules.filter(
      (r) =>
        r.userAgent === '*' ||
        this.userAgent.toLowerCase().includes(r.userAgent.toLowerCase())
    );

    // Check disallow rules
    for (const rule of applicableRules) {
      for (const disallow of rule.disallow) {
        if (this.pathMatches(pathname, disallow)) {
          // Check if there's an allow that's more specific
          const allowed = rule.allow.some(
            (a) => this.pathMatches(pathname, a) && a.length > disallow.length
          );
          if (!allowed) return false;
        }
      }
    }

    return true;
  }

  /**
   * Parse robots.txt content
   */
  private parse(text: string): RobotsRule[] {
    const rules: RobotsRule[] = [];
    let currentRule: RobotsRule | null = null;

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;

      const directive = trimmed.slice(0, colonIndex).trim().toLowerCase();
      const value = trimmed.slice(colonIndex + 1).trim();

      switch (directive) {
        case 'user-agent':
          if (currentRule) rules.push(currentRule);
          currentRule = { userAgent: value, allow: [], disallow: [] };
          break;
        case 'allow':
          if (currentRule && value) currentRule.allow.push(value);
          break;
        case 'disallow':
          if (currentRule && value) currentRule.disallow.push(value);
          break;
        // Ignore other directives (Crawl-delay, Sitemap, etc.)
      }
    }

    if (currentRule) rules.push(currentRule);
    return rules;
  }

  /**
   * Check if a pathname matches a robots.txt pattern
   * Supports * and $ wildcards
   */
  private pathMatches(pathname: string, pattern: string): boolean {
    if (!pattern) return false;

    // Convert robots.txt pattern to regex
    let regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars (except * and $)
      .replace(/\*/g, '.*'); // * matches anything

    // $ at end means exact match
    if (regexPattern.endsWith('$')) {
      regexPattern = regexPattern.slice(0, -1) + '$';
    } else {
      regexPattern = '^' + regexPattern;
    }

    try {
      return new RegExp(regexPattern).test(pathname);
    } catch {
      // Invalid pattern, do simple prefix match
      return pathname.startsWith(pattern.replace(/\*|\$/g, ''));
    }
  }
}
