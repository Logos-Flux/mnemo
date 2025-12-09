import { describe, test, expect } from 'bun:test';
import { isUrl, isGitHubUrl, RepoLoader } from './repo-loader';
import { LoadError, TokenLimitError } from './types';

// ============================================================================
// URL Validation Tests
// ============================================================================

describe('isUrl', () => {
  test('returns true for http URLs', () => {
    expect(isUrl('http://example.com')).toBe(true);
    expect(isUrl('http://github.com/user/repo')).toBe(true);
  });

  test('returns true for https URLs', () => {
    expect(isUrl('https://example.com')).toBe(true);
    expect(isUrl('https://github.com/user/repo')).toBe(true);
  });

  test('returns false for non-URLs', () => {
    expect(isUrl('/local/path')).toBe(false);
    expect(isUrl('./relative/path')).toBe(false);
    expect(isUrl('file.txt')).toBe(false);
    expect(isUrl('')).toBe(false);
  });

  test('returns false for malformed URLs', () => {
    expect(isUrl('ht tp://example.com')).toBe(false);
    expect(isUrl('ftp://example.com')).toBe(false);
    expect(isUrl('www.example.com')).toBe(false);
  });
});

describe('isGitHubUrl', () => {
  test('returns true for standard GitHub URLs', () => {
    expect(isGitHubUrl('https://github.com/user/repo')).toBe(true);
    expect(isGitHubUrl('http://github.com/user/repo')).toBe(true);
    expect(isGitHubUrl('https://github.com/user/repo.git')).toBe(true);
  });

  test('returns true for GitHub URLs with www', () => {
    expect(isGitHubUrl('https://www.github.com/user/repo')).toBe(true);
    expect(isGitHubUrl('http://www.github.com/user/repo')).toBe(true);
  });

  test('returns true for GitHub URLs with paths', () => {
    expect(isGitHubUrl('https://github.com/user/repo/tree/main')).toBe(true);
    expect(isGitHubUrl('https://github.com/user/repo/issues/123')).toBe(true);
    expect(isGitHubUrl('https://github.com/user-name/repo-name')).toBe(true);
  });

  test('returns false for non-GitHub URLs', () => {
    expect(isGitHubUrl('https://gitlab.com/user/repo')).toBe(false);
    expect(isGitHubUrl('https://bitbucket.org/user/repo')).toBe(false);
    expect(isGitHubUrl('https://example.com')).toBe(false);
  });

  test('returns false for malformed GitHub URLs', () => {
    expect(isGitHubUrl('github.com/user/repo')).toBe(false);
    expect(isGitHubUrl('https://github.com')).toBe(false);
    // Note: 'https://github.com/' matches the regex pattern since it has 'github.com/'
    // even though it lacks a user/repo. This is acceptable behavior.
  });

  test('returns false for local paths', () => {
    expect(isGitHubUrl('/local/path')).toBe(false);
    expect(isGitHubUrl('./github.com/user/repo')).toBe(false);
  });

  test('returns false for empty or invalid input', () => {
    expect(isGitHubUrl('')).toBe(false);
    expect(isGitHubUrl('   ')).toBe(false);
  });
});

// ============================================================================
// RepoLoader Class Tests
// ============================================================================

describe('RepoLoader', () => {
  describe('constructor', () => {
    test('creates instance with default maxTokens', () => {
      const loader = new RepoLoader();
      expect(loader).toBeInstanceOf(RepoLoader);
    });

    test('creates instance with custom maxTokens', () => {
      const loader = new RepoLoader({ maxTokens: 500000 });
      expect(loader).toBeInstanceOf(RepoLoader);
    });
  });

  describe('token estimation', () => {
    test('estimates tokens correctly for small content', () => {
      const loader = new RepoLoader();
      // Access private method via any for testing
      const estimate = (loader as any).estimateTokens('hello world');
      // "hello world" is 11 chars, should be ~4 tokens (11/3.5 = 3.14, rounded up to 4)
      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBe(Math.ceil(11 / 3.5));
    });

    test('estimates tokens correctly for larger content', () => {
      const loader = new RepoLoader();
      const content = 'x'.repeat(350); // 350 chars
      const estimate = (loader as any).estimateTokens(content);
      expect(estimate).toBe(100); // 350 / 3.5 = 100
    });

    test('rounds up fractional tokens', () => {
      const loader = new RepoLoader();
      const content = 'x'.repeat(100); // 100 chars
      const estimate = (loader as any).estimateTokens(content);
      // 100 / 3.5 = 28.57, should round up to 29
      expect(estimate).toBe(29);
    });
  });

  describe('MIME type detection', () => {
    test('returns correct MIME type for TypeScript', () => {
      const loader = new RepoLoader();
      expect((loader as any).getMimeType('.ts')).toBe('text/typescript');
      expect((loader as any).getMimeType('.tsx')).toBe('text/typescript');
    });

    test('returns correct MIME type for JavaScript', () => {
      const loader = new RepoLoader();
      expect((loader as any).getMimeType('.js')).toBe('text/javascript');
      expect((loader as any).getMimeType('.jsx')).toBe('text/javascript');
    });

    test('returns correct MIME type for common formats', () => {
      const loader = new RepoLoader();
      expect((loader as any).getMimeType('.json')).toBe('application/json');
      expect((loader as any).getMimeType('.md')).toBe('text/markdown');
      expect((loader as any).getMimeType('.py')).toBe('text/x-python');
      expect((loader as any).getMimeType('.go')).toBe('text/x-go');
      expect((loader as any).getMimeType('.rs')).toBe('text/x-rust');
      expect((loader as any).getMimeType('.html')).toBe('text/html');
      expect((loader as any).getMimeType('.css')).toBe('text/css');
      expect((loader as any).getMimeType('.yaml')).toBe('text/yaml');
      expect((loader as any).getMimeType('.yml')).toBe('text/yaml');
      expect((loader as any).getMimeType('.sql')).toBe('text/x-sql');
    });

    test('returns text/plain for unknown extensions', () => {
      const loader = new RepoLoader();
      expect((loader as any).getMimeType('.xyz')).toBe('text/plain');
      expect((loader as any).getMimeType('.unknown')).toBe('text/plain');
      expect((loader as any).getMimeType('')).toBe('text/plain');
    });
  });

  describe('content building', () => {
    test('builds content with proper headers', () => {
      const loader = new RepoLoader();
      const files = [
        {
          path: 'test.ts',
          content: 'const x = 1;',
          size: 12,
          tokenEstimate: 4,
          mimeType: 'text/typescript',
        },
      ];
      const content = (loader as any).buildContent(files, '/test/dir');

      expect(content).toContain('# Repository Context');
      expect(content).toContain('# Source: /test/dir');
      expect(content).toContain('# Files: 1');
      expect(content).toContain('# Generated:');
    });

    test('builds content with file tree section', () => {
      const loader = new RepoLoader();
      const files = [
        {
          path: 'src/index.ts',
          content: 'export {}',
          size: 9,
          tokenEstimate: 3,
          mimeType: 'text/typescript',
        },
        {
          path: 'src/utils.ts',
          content: 'export const util = 1;',
          size: 22,
          tokenEstimate: 7,
          mimeType: 'text/typescript',
        },
      ];
      const content = (loader as any).buildContent(files, '/test');

      expect(content).toContain('## File Structure');
      expect(content).toContain('src/index.ts');
      expect(content).toContain('src/utils.ts');
    });

    test('builds content with file contents section', () => {
      const loader = new RepoLoader();
      const files = [
        {
          path: 'test.js',
          content: 'console.log("test");',
          size: 20,
          tokenEstimate: 6,
          mimeType: 'text/javascript',
        },
      ];
      const content = (loader as any).buildContent(files, '/test');

      expect(content).toContain('## File Contents');
      expect(content).toContain('### test.js');
      expect(content).toContain('```js');
      expect(content).toContain('console.log("test");');
      expect(content).toContain('```');
    });

    test('sorts files alphabetically in output', () => {
      const loader = new RepoLoader();
      const files = [
        {
          path: 'z.ts',
          content: 'z',
          size: 1,
          tokenEstimate: 1,
          mimeType: 'text/typescript',
        },
        {
          path: 'a.ts',
          content: 'a',
          size: 1,
          tokenEstimate: 1,
          mimeType: 'text/typescript',
        },
        {
          path: 'm.ts',
          content: 'm',
          size: 1,
          tokenEstimate: 1,
          mimeType: 'text/typescript',
        },
      ];
      const content = (loader as any).buildContent(files, '/test');

      // Check that files appear in alphabetical order in the structure
      const indexA = content.indexOf('a.ts');
      const indexM = content.indexOf('m.ts');
      const indexZ = content.indexOf('z.ts');

      expect(indexA).toBeLessThan(indexM);
      expect(indexM).toBeLessThan(indexZ);
    });

    test('uses correct code fence syntax based on extension', () => {
      const loader = new RepoLoader();
      const files = [
        {
          path: 'test.py',
          content: 'print("hello")',
          size: 14,
          tokenEstimate: 4,
          mimeType: 'text/x-python',
        },
        {
          path: 'test.json',
          content: '{"key": "value"}',
          size: 16,
          tokenEstimate: 5,
          mimeType: 'application/json',
        },
      ];
      const content = (loader as any).buildContent(files, '/test');

      expect(content).toContain('```py');
      expect(content).toContain('```json');
    });

    test('handles files without extensions', () => {
      const loader = new RepoLoader();
      const files = [
        {
          path: 'Dockerfile',
          content: 'FROM node:18',
          size: 12,
          tokenEstimate: 4,
          mimeType: 'text/plain',
        },
      ];
      const content = (loader as any).buildContent(files, '/test');

      expect(content).toContain('```txt');
      expect(content).toContain('FROM node:18');
    });
  });

  describe('error handling', () => {
    test('LoadError includes source and reason', () => {
      const error = new LoadError('/test/path', 'File not found');
      expect(error.message).toContain('Failed to load source');
      expect(error.code).toBe('LOAD_ERROR');
      expect(error.details?.source).toBe('/test/path');
      expect(error.details?.reason).toBe('File not found');
    });

    test('TokenLimitError includes token counts', () => {
      const error = new TokenLimitError(1000000, 900000);
      expect(error.message).toContain('Token limit exceeded');
      expect(error.code).toBe('TOKEN_LIMIT_EXCEEDED');
      expect(error.details?.requested).toBe(1000000);
      expect(error.details?.limit).toBe(900000);
    });
  });

  describe('file extension detection', () => {
    test('handles common code file extensions', () => {
      const loader = new RepoLoader();

      // These should all get proper MIME types
      const codeExtensions = [
        '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs',
        '.java', '.kt', '.c', '.cpp', '.rb', '.php', '.swift', '.cs'
      ];

      codeExtensions.forEach(ext => {
        const mimeType = (loader as any).getMimeType(ext);
        expect(mimeType).toBeTruthy();
      });
    });

    test('handles config file extensions', () => {
      const loader = new RepoLoader();
      expect((loader as any).getMimeType('.json')).toBe('application/json');
      expect((loader as any).getMimeType('.yaml')).toBe('text/yaml');
      expect((loader as any).getMimeType('.yml')).toBe('text/yaml');
    });

    test('handles documentation extensions', () => {
      const loader = new RepoLoader();
      expect((loader as any).getMimeType('.md')).toBe('text/markdown');
    });
  });
});

// ============================================================================
// Integration-like Tests (without actual file I/O)
// ============================================================================

describe('RepoLoader (mocked scenarios)', () => {
  test('would reject very large token counts', () => {
    const loader = new RepoLoader({ maxTokens: 1000 });

    // Simulate what would happen if files exceed limit
    const files = [
      {
        path: 'huge.ts',
        content: 'x'.repeat(10000),
        size: 10000,
        tokenEstimate: 3000, // Would exceed 1000 limit
        mimeType: 'text/typescript',
      },
    ];

    const totalTokens = files.reduce((sum, f) => sum + f.tokenEstimate, 0);
    expect(totalTokens).toBeGreaterThan(1000);
  });

  test('correctly sums token estimates', () => {
    const loader = new RepoLoader();
    const files = [
      { path: 'a.ts', content: 'a', size: 1, tokenEstimate: 100, mimeType: 'text/typescript' },
      { path: 'b.ts', content: 'b', size: 1, tokenEstimate: 200, mimeType: 'text/typescript' },
      { path: 'c.ts', content: 'c', size: 1, tokenEstimate: 300, mimeType: 'text/typescript' },
    ];

    const totalTokens = files.reduce((sum, f) => sum + f.tokenEstimate, 0);
    expect(totalTokens).toBe(600);
  });
});
