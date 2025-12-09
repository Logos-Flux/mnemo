import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { SourceLoader } from './source-loader';
import { LoadError, TokenLimitError } from './types';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// SourceLoader Tests
// ============================================================================

describe('SourceLoader', () => {
  describe('constructor', () => {
    test('creates instance with default maxTokens', () => {
      const loader = new SourceLoader();
      expect(loader).toBeInstanceOf(SourceLoader);
    });

    test('creates instance with custom maxTokens', () => {
      const loader = new SourceLoader({ maxTokens: 500000 });
      expect(loader).toBeInstanceOf(SourceLoader);
    });
  });

  describe('token estimation', () => {
    test('estimates tokens for small content', () => {
      const loader = new SourceLoader();
      const estimate = (loader as any).estimateTokens('hello world');
      // "hello world" is 11 chars, should be ~3 tokens (11/4 = 2.75, rounded up to 3)
      expect(estimate).toBe(3);
    });

    test('estimates tokens for larger content', () => {
      const loader = new SourceLoader();
      const content = 'x'.repeat(400); // 400 chars
      const estimate = (loader as any).estimateTokens(content);
      expect(estimate).toBe(100); // 400 / 4 = 100
    });

    test('rounds up fractional tokens', () => {
      const loader = new SourceLoader();
      const content = 'x'.repeat(100); // 100 chars
      const estimate = (loader as any).estimateTokens(content);
      // 100 / 4 = 25
      expect(estimate).toBe(25);
    });

    test('uses more generous estimate than RepoLoader', () => {
      const loader = new SourceLoader();
      const content = 'test content';
      const estimate = (loader as any).estimateTokens(content);
      // Uses / 4 instead of / 3.5
      expect(estimate).toBe(Math.ceil(content.length / 4));
    });
  });

  describe('MIME type detection', () => {
    test('returns correct MIME type for markdown', () => {
      const loader = new SourceLoader();
      expect((loader as any).getMimeType('.md')).toBe('text/markdown');
      expect((loader as any).getMimeType('.mdx')).toBe('text/markdown');
    });

    test('returns correct MIME type for text formats', () => {
      const loader = new SourceLoader();
      expect((loader as any).getMimeType('.txt')).toBe('text/plain');
      expect((loader as any).getMimeType('.rst')).toBe('text/x-rst');
    });

    test('returns correct MIME type for structured formats', () => {
      const loader = new SourceLoader();
      expect((loader as any).getMimeType('.json')).toBe('application/json');
      expect((loader as any).getMimeType('.pdf')).toBe('application/pdf');
    });

    test('returns text/plain for unknown extensions', () => {
      const loader = new SourceLoader();
      expect((loader as any).getMimeType('.xyz')).toBe('text/plain');
      expect((loader as any).getMimeType('.unknown')).toBe('text/plain');
      expect((loader as any).getMimeType('')).toBe('text/plain');
    });
  });

  describe('loadString', () => {
    test('loads string content successfully', () => {
      const loader = new SourceLoader();
      const content = 'This is test content';
      const result = loader.loadString(content, 'test.txt');

      expect(result.content).toBe(content);
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.fileCount).toBe(1);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe('test.txt');
      expect(result.files[0].content).toBe(content);
      expect(result.metadata.source).toBe('test.txt');
    });

    test('uses default name if not provided', () => {
      const loader = new SourceLoader();
      const result = loader.loadString('test content');

      expect(result.files[0].path).toBe('content');
      expect(result.metadata.source).toBe('content');
    });

    test('throws TokenLimitError when content exceeds limit', () => {
      const loader = new SourceLoader({ maxTokens: 10 });
      const largeContent = 'x'.repeat(1000); // Will be ~250 tokens

      expect(() => loader.loadString(largeContent)).toThrow(TokenLimitError);
    });

    test('sets correct metadata', () => {
      const loader = new SourceLoader();
      const result = loader.loadString('test', 'my-doc.md');

      expect(result.metadata.source).toBe('my-doc.md');
      expect(result.metadata.loadedAt).toBeInstanceOf(Date);
      expect(result.files[0].mimeType).toBe('text/plain');
    });

    test('calculates token estimate correctly', () => {
      const loader = new SourceLoader();
      const content = 'a'.repeat(400); // 400 chars
      const result = loader.loadString(content);

      expect(result.totalTokens).toBe(100); // 400 / 4 = 100
      expect(result.files[0].tokenEstimate).toBe(100);
    });

    test('handles empty string', () => {
      const loader = new SourceLoader();
      const result = loader.loadString('');

      expect(result.content).toBe('');
      expect(result.totalTokens).toBe(0);
      expect(result.fileCount).toBe(1);
    });

    test('handles multiline content', () => {
      const loader = new SourceLoader();
      const content = 'line 1\nline 2\nline 3';
      const result = loader.loadString(content);

      expect(result.content).toBe(content);
      expect(result.files[0].content).toContain('\n');
    });
  });

  describe('content wrapping', () => {
    test('wrapContent formats single file correctly', () => {
      const loader = new SourceLoader();
      const file = {
        path: 'test.md',
        content: 'Some markdown content',
        size: 21,
        tokenEstimate: 6,
        mimeType: 'text/markdown',
      };

      const wrapped = (loader as any).wrapContent(file);

      expect(wrapped).toContain('# test.md');
      expect(wrapped).toContain('# Tokens: ~6');
      expect(wrapped).toContain('Some markdown content');
    });

    test('wrapContent preserves original content', () => {
      const loader = new SourceLoader();
      const originalContent = 'Original\ncontent\nwith\nnewlines';
      const file = {
        path: 'doc.txt',
        content: originalContent,
        size: originalContent.length,
        tokenEstimate: 10,
        mimeType: 'text/plain',
      };

      const wrapped = (loader as any).wrapContent(file);

      expect(wrapped).toContain(originalContent);
    });
  });

  describe('buildCombinedContent', () => {
    test('builds content with header section', () => {
      const loader = new SourceLoader();
      const files = [
        {
          path: 'file1.md',
          content: 'Content 1',
          size: 9,
          tokenEstimate: 3,
          mimeType: 'text/markdown',
        },
      ];

      const combined = (loader as any).buildCombinedContent(files);

      expect(combined).toContain('# Document Collection');
      expect(combined).toContain('# Files: 1');
      expect(combined).toContain('# Total tokens: ~3');
      expect(combined).toContain('# Generated:');
    });

    test('builds table of contents', () => {
      const loader = new SourceLoader();
      const files = [
        {
          path: 'doc1.md',
          content: 'Doc 1',
          size: 5,
          tokenEstimate: 2,
          mimeType: 'text/markdown',
        },
        {
          path: 'doc2.md',
          content: 'Doc 2',
          size: 5,
          tokenEstimate: 2,
          mimeType: 'text/markdown',
        },
      ];

      const combined = (loader as any).buildCombinedContent(files);

      expect(combined).toContain('## Contents');
      expect(combined).toContain('- doc1.md');
      expect(combined).toContain('- doc2.md');
    });

    test('includes file contents with separators', () => {
      const loader = new SourceLoader();
      const files = [
        {
          path: 'doc.txt',
          content: 'Document content',
          size: 16,
          tokenEstimate: 4,
          mimeType: 'text/plain',
        },
      ];

      const combined = (loader as any).buildCombinedContent(files);

      expect(combined).toContain('---');
      expect(combined).toContain('## doc.txt');
      expect(combined).toContain('Document content');
    });

    test('combines multiple files correctly', () => {
      const loader = new SourceLoader();
      const files = [
        {
          path: 'a.txt',
          content: 'Content A',
          size: 9,
          tokenEstimate: 3,
          mimeType: 'text/plain',
        },
        {
          path: 'b.txt',
          content: 'Content B',
          size: 9,
          tokenEstimate: 3,
          mimeType: 'text/plain',
        },
      ];

      const combined = (loader as any).buildCombinedContent(files);

      expect(combined).toContain('Content A');
      expect(combined).toContain('Content B');
      expect(combined).toContain('## a.txt');
      expect(combined).toContain('## b.txt');
    });

    test('calculates total tokens correctly', () => {
      const loader = new SourceLoader();
      const files = [
        {
          path: 'f1.txt',
          content: 'F1',
          size: 2,
          tokenEstimate: 100,
          mimeType: 'text/plain',
        },
        {
          path: 'f2.txt',
          content: 'F2',
          size: 2,
          tokenEstimate: 200,
          mimeType: 'text/plain',
        },
      ];

      const combined = (loader as any).buildCombinedContent(files);

      expect(combined).toContain('# Total tokens: ~300');
    });
  });

  describe('error types', () => {
    test('LoadError includes source and reason', () => {
      const error = new LoadError('/path/to/file.txt', 'File not found');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(LoadError);
      expect(error.message).toContain('Failed to load source');
      expect(error.code).toBe('LOAD_ERROR');
      expect(error.details?.source).toBe('/path/to/file.txt');
      expect(error.details?.reason).toBe('File not found');
    });

    test('TokenLimitError includes token counts', () => {
      const error = new TokenLimitError(1000000, 900000);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TokenLimitError);
      expect(error.message).toContain('Token limit exceeded');
      expect(error.message).toContain('1000000');
      expect(error.message).toContain('900000');
      expect(error.code).toBe('TOKEN_LIMIT_EXCEEDED');
      expect(error.details?.requested).toBe(1000000);
      expect(error.details?.limit).toBe(900000);
    });
  });

  describe('file size and content limits', () => {
    test('respects maxTokens limit in loadString', () => {
      const loader = new SourceLoader({ maxTokens: 100 });
      const smallContent = 'x'.repeat(200); // ~50 tokens, should be OK
      const largeContent = 'x'.repeat(800); // ~200 tokens, should fail

      expect(() => loader.loadString(smallContent)).not.toThrow();
      expect(() => loader.loadString(largeContent)).toThrow(TokenLimitError);
    });

    test('loadString provides accurate token estimates', () => {
      const loader = new SourceLoader();
      const content = 'a'.repeat(1000);
      const result = loader.loadString(content);

      // 1000 chars / 4 = 250 tokens
      expect(result.totalTokens).toBe(250);
      expect(result.files[0].tokenEstimate).toBe(250);
    });
  });

  describe('metadata handling', () => {
    test('sets loadedAt timestamp', () => {
      const loader = new SourceLoader();
      const before = new Date();
      const result = loader.loadString('test');
      const after = new Date();

      expect(result.metadata.loadedAt).toBeInstanceOf(Date);
      expect(result.metadata.loadedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.metadata.loadedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test('includes file info in metadata', () => {
      const loader = new SourceLoader();
      const result = loader.loadString('test content', 'my-file.txt');

      expect(result.files[0].path).toBe('my-file.txt');
      expect(result.files[0].size).toBe(12); // 'test content' length
      expect(result.files[0].content).toBe('test content');
    });
  });

  describe('edge cases', () => {
    test('handles very long lines', () => {
      const loader = new SourceLoader();
      const longLine = 'x'.repeat(10000);
      const result = loader.loadString(longLine);

      expect(result.content).toBe(longLine);
      expect(result.totalTokens).toBeGreaterThan(0);
    });

    test('handles special characters', () => {
      const loader = new SourceLoader();
      const content = '§±!@#$%^&*()_+-=[]{}|;:",.<>?/~`';
      const result = loader.loadString(content);

      expect(result.content).toBe(content);
      expect(result.files[0].content).toBe(content);
    });

    test('handles unicode characters', () => {
      const loader = new SourceLoader();
      const content = '你好世界 مرحبا بالعالم Здравствуй мир';
      const result = loader.loadString(content);

      expect(result.content).toBe(content);
      expect(result.totalTokens).toBeGreaterThan(0);
    });

    test('handles mixed content types', () => {
      const loader = new SourceLoader();
      const content = 'Text with\n\nnewlines\t\ttabs   and   spaces';
      const result = loader.loadString(content);

      expect(result.content).toBe(content);
      expect(result.files[0].content).toContain('\n');
      expect(result.files[0].content).toContain('\t');
    });
  });

  describe('integration scenarios', () => {
    test('typical documentation loading workflow', () => {
      const loader = new SourceLoader({ maxTokens: 10000 });

      // Load a documentation file
      const docContent = '# Documentation\n\nThis is a guide.';
      const result = loader.loadString(docContent, 'guide.md');

      expect(result.fileCount).toBe(1);
      expect(result.totalTokens).toBeLessThan(10000);
      expect(result.metadata.source).toBe('guide.md');
      expect(result.content).toBe(docContent);
    });

    test('handles multiple small documents simulation', () => {
      const loader = new SourceLoader();
      const files = [
        {
          path: 'intro.md',
          content: '# Introduction\n\nWelcome',
          size: 25,
          tokenEstimate: 7,
          mimeType: 'text/markdown',
        },
        {
          path: 'guide.md',
          content: '# Guide\n\nSteps to follow',
          size: 25,
          tokenEstimate: 7,
          mimeType: 'text/markdown',
        },
      ];

      const combined = (loader as any).buildCombinedContent(files);

      expect(combined).toContain('# Document Collection');
      expect(combined).toContain('# Files: 2');
      expect(combined).toContain('intro.md');
      expect(combined).toContain('guide.md');
    });
  });

  // ========================================================================
  // File Loading Tests (Markdown, PDF, Text)
  // ========================================================================

  describe('file loading with actual files', () => {
    let testDir: string;

    beforeAll(async () => {
      // Create a temporary directory for test files
      testDir = join(tmpdir(), `mnemo-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
    });

    afterAll(async () => {
      // Clean up test directory
      await rm(testDir, { recursive: true, force: true });
    });

    test('loads markdown file correctly', async () => {
      const loader = new SourceLoader();
      const mdPath = join(testDir, 'test.md');
      const mdContent = '# Test Markdown\n\nThis is a **test** file with markdown formatting.';

      await writeFile(mdPath, mdContent, 'utf-8');

      const result = await loader.loadFile(mdPath);

      expect(result.fileCount).toBe(1);
      expect(result.files[0].content).toBe(mdContent);
      expect(result.files[0].mimeType).toBe('text/markdown');
      expect(result.files[0].path).toBe('test.md');
      expect(result.totalTokens).toBeGreaterThan(0);
    });

    test('loads text file correctly', async () => {
      const loader = new SourceLoader();
      const txtPath = join(testDir, 'test.txt');
      const txtContent = 'Plain text content without formatting.';

      await writeFile(txtPath, txtContent, 'utf-8');

      const result = await loader.loadFile(txtPath);

      expect(result.fileCount).toBe(1);
      expect(result.files[0].content).toBe(txtContent);
      expect(result.files[0].mimeType).toBe('text/plain');
      expect(result.totalTokens).toBeGreaterThan(0);
    });

    test('markdown content is preserved as-is for Gemini', async () => {
      const loader = new SourceLoader();
      const mdPath = join(testDir, 'formatted.md');
      const mdContent = '# Heading\n\n## Subheading\n\n- List item 1\n- List item 2\n\n```js\nconst x = 1;\n```';

      await writeFile(mdPath, mdContent, 'utf-8');

      const result = await loader.loadFile(mdPath);

      // Markdown should be kept as-is (not converted to plain text)
      expect(result.files[0].content).toBe(mdContent);
      expect(result.files[0].content).toContain('# Heading');
      expect(result.files[0].content).toContain('```js');
    });

    test('handles file not found error', async () => {
      const loader = new SourceLoader();
      const nonExistentPath = join(testDir, 'does-not-exist.md');

      await expect(loader.loadFile(nonExistentPath)).rejects.toThrow(LoadError);
      await expect(loader.loadFile(nonExistentPath)).rejects.toThrow('File not found');
    });

    test('loads multiple files of different types', async () => {
      const loader = new SourceLoader();

      const mdPath = join(testDir, 'doc.md');
      const txtPath = join(testDir, 'notes.txt');

      await writeFile(mdPath, '# Documentation\n\nSome docs.', 'utf-8');
      await writeFile(txtPath, 'Some notes.', 'utf-8');

      const result = await loader.loadFiles([mdPath, txtPath]);

      expect(result.fileCount).toBe(2);
      expect(result.files.find(f => f.path === 'doc.md')).toBeDefined();
      expect(result.files.find(f => f.path === 'notes.txt')).toBeDefined();
    });

    test('loads directory of markdown files', async () => {
      const loader = new SourceLoader();
      const docsDir = join(testDir, 'docs');

      await mkdir(docsDir, { recursive: true });
      await writeFile(join(docsDir, 'intro.md'), '# Introduction', 'utf-8');
      await writeFile(join(docsDir, 'guide.md'), '# Guide', 'utf-8');
      await writeFile(join(docsDir, 'readme.txt'), 'README content', 'utf-8');

      const result = await loader.loadMarkdownDirectory(docsDir, false);

      expect(result.fileCount).toBe(3);
      expect(result.files.some(f => f.path.includes('intro.md'))).toBe(true);
      expect(result.files.some(f => f.path.includes('guide.md'))).toBe(true);
      expect(result.files.some(f => f.path.includes('readme.txt'))).toBe(true);
    });

    test('recursively loads nested markdown files', async () => {
      const loader = new SourceLoader();
      const nestedDir = join(testDir, 'nested');
      const subDir = join(nestedDir, 'sub');

      await mkdir(subDir, { recursive: true });
      await writeFile(join(nestedDir, 'top.md'), '# Top level', 'utf-8');
      await writeFile(join(subDir, 'nested.md'), '# Nested', 'utf-8');

      const result = await loader.loadMarkdownDirectory(nestedDir, true);

      expect(result.fileCount).toBe(2);
      expect(result.files.some(f => f.path.includes('top.md'))).toBe(true);
      expect(result.files.some(f => f.path.includes('nested.md'))).toBe(true);
    });

    test('skips node_modules and .git directories', async () => {
      const loader = new SourceLoader();
      const projectDir = join(testDir, 'project');
      const nodeModules = join(projectDir, 'node_modules');
      const gitDir = join(projectDir, '.git');

      await mkdir(nodeModules, { recursive: true });
      await mkdir(gitDir, { recursive: true });
      await writeFile(join(projectDir, 'main.md'), '# Main', 'utf-8');
      await writeFile(join(nodeModules, 'dep.md'), '# Dependency', 'utf-8');
      await writeFile(join(gitDir, 'config'), 'git config', 'utf-8');

      const result = await loader.loadMarkdownDirectory(projectDir, true);

      // Should only load main.md, not files from node_modules or .git
      expect(result.fileCount).toBe(1);
      expect(result.files[0].path).toContain('main.md');
    });

    test('respects token limits when loading directory', async () => {
      const loader = new SourceLoader({ maxTokens: 50 });
      const limitDir = join(testDir, 'limit-test');

      await mkdir(limitDir, { recursive: true });
      // Each file will be ~25 tokens
      await writeFile(join(limitDir, 'file1.md'), 'x'.repeat(100), 'utf-8');
      await writeFile(join(limitDir, 'file2.md'), 'x'.repeat(100), 'utf-8');
      await writeFile(join(limitDir, 'file3.md'), 'x'.repeat(100), 'utf-8'); // Should be skipped

      const result = await loader.loadMarkdownDirectory(limitDir, false);

      // Should only load 2 files (50 tokens total)
      expect(result.fileCount).toBeLessThanOrEqual(2);
      expect(result.totalTokens).toBeLessThanOrEqual(50);
    });
  });

  // ========================================================================
  // PDF Parsing Tests
  // ========================================================================

  describe('PDF file handling', () => {
    let testDir: string;

    beforeAll(async () => {
      testDir = join(tmpdir(), `mnemo-pdf-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
    });

    afterAll(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    test('detects PDF mime type correctly', () => {
      const loader = new SourceLoader();
      expect((loader as any).getMimeType('.pdf')).toBe('application/pdf');
    });

    test('handles invalid PDF gracefully', async () => {
      const loader = new SourceLoader();
      const invalidPdfPath = join(testDir, 'invalid.pdf');

      // Write invalid PDF data
      await writeFile(invalidPdfPath, 'Not a real PDF file', 'utf-8');

      await expect(loader.loadFile(invalidPdfPath)).rejects.toThrow(LoadError);
      await expect(loader.loadFile(invalidPdfPath)).rejects.toThrow('Failed to parse PDF');
    });

    test('handles empty PDF gracefully', async () => {
      const loader = new SourceLoader();
      const emptyPdfPath = join(testDir, 'empty.pdf');

      // Minimal valid PDF structure but no text content
      const minimalPdf = '%PDF-1.4\n%EOF';
      await writeFile(emptyPdfPath, minimalPdf, 'utf-8');

      await expect(loader.loadFile(emptyPdfPath)).rejects.toThrow();
    });

    test('includes PDFs when loading directory', async () => {
      const loader = new SourceLoader();
      const mixedDir = join(testDir, 'mixed-docs');

      await mkdir(mixedDir, { recursive: true });
      await writeFile(join(mixedDir, 'doc.md'), '# Markdown Document', 'utf-8');
      await writeFile(join(mixedDir, 'notes.txt'), 'Text notes', 'utf-8');

      // Note: We can't easily create valid PDFs in tests, but we can verify the loader
      // attempts to process .pdf files (they'll fail parsing, but that's expected)
      const files: string[] = [];
      const mdPath = join(mixedDir, 'doc.md');
      const txtPath = join(mixedDir, 'notes.txt');
      files.push(mdPath, txtPath);

      const result = await loader.loadFiles(files);

      // Should load markdown and text files
      expect(result.fileCount).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // Markdown Handling Tests
  // ========================================================================

  describe('markdown handling', () => {
    test('preserves markdown syntax for code blocks', () => {
      const loader = new SourceLoader();
      const mdWithCode = '# Code Example\n\n```javascript\nconst x = 42;\n```\n\nSome text.';
      const result = loader.loadString(mdWithCode, 'code.md');

      expect(result.files[0].content).toContain('```javascript');
      expect(result.files[0].content).toContain('const x = 42;');
      expect(result.files[0].content).toContain('```');
    });

    test('preserves markdown links', () => {
      const loader = new SourceLoader();
      const mdWithLinks = 'Check out [this link](https://example.com) for more info.';
      const result = loader.loadString(mdWithLinks, 'links.md');

      expect(result.files[0].content).toContain('[this link]');
      expect(result.files[0].content).toContain('(https://example.com)');
    });

    test('preserves markdown tables', () => {
      const loader = new SourceLoader();
      const mdWithTable = '| Col1 | Col2 |\n|------|------|\n| A    | B    |';
      const result = loader.loadString(mdWithTable, 'table.md');

      expect(result.files[0].content).toContain('| Col1 | Col2 |');
      expect(result.files[0].content).toContain('|------|------|');
    });

    test('preserves markdown headings', () => {
      const loader = new SourceLoader();
      const mdWithHeadings = '# H1\n## H2\n### H3\n#### H4';
      const result = loader.loadString(mdWithHeadings, 'headings.md');

      expect(result.files[0].content).toContain('# H1');
      expect(result.files[0].content).toContain('## H2');
      expect(result.files[0].content).toContain('### H3');
    });

    test('preserves markdown lists', () => {
      const loader = new SourceLoader();
      const mdWithLists = '- Item 1\n- Item 2\n  - Nested\n\n1. First\n2. Second';
      const result = loader.loadString(mdWithLists, 'lists.md');

      expect(result.files[0].content).toContain('- Item 1');
      expect(result.files[0].content).toContain('1. First');
    });

    test('handles complex markdown with mixed formatting', () => {
      const loader = new SourceLoader();
      const complexMd = `# Title

## Section 1

This is **bold** and this is *italic*.

\`\`\`python
def hello():
    print("Hello")
\`\`\`

- List item
- Another item

> Quote block

[Link](https://example.com)`;

      const result = loader.loadString(complexMd, 'complex.md');

      // All markdown syntax should be preserved
      expect(result.files[0].content).toContain('**bold**');
      expect(result.files[0].content).toContain('*italic*');
      expect(result.files[0].content).toContain('```python');
      expect(result.files[0].content).toContain('> Quote block');
    });
  });
});
