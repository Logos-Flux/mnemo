import { readFile, stat, readdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import type { FileInfo, LoadedSource } from './types';
import { LoadError, TokenLimitError } from './types';
import { resolvePDFJS } from 'pdfjs-serverless';

/**
 * Load individual files or collections of documents
 */
export class SourceLoader {
  private maxTokens: number;

  constructor(options: { maxTokens?: number } = {}) {
    this.maxTokens = options.maxTokens ?? 900000;
  }

  /**
   * Load a single file
   * @param filePath - Path to the file
   * @returns Loaded source
   */
  async loadFile(filePath: string): Promise<LoadedSource> {
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) {
        throw new LoadError(filePath, 'Path is not a file');
      }

      const ext = extname(filePath).toLowerCase();
      let content: string;

      // Route to appropriate parser based on file type
      if (ext === '.pdf') {
        content = await this.parsePdf(filePath);
      } else {
        // For text files (including markdown), read as UTF-8
        content = await readFile(filePath, 'utf-8');
      }

      const tokenEstimate = this.estimateTokens(content);

      if (tokenEstimate > this.maxTokens) {
        throw new TokenLimitError(tokenEstimate, this.maxTokens);
      }

      const file: FileInfo = {
        path: basename(filePath),
        content,
        size: stats.size,
        tokenEstimate,
        mimeType: this.getMimeType(ext),
      };

      return {
        content: this.wrapContent(file),
        totalTokens: tokenEstimate,
        fileCount: 1,
        files: [file],
        metadata: {
          source: filePath,
          loadedAt: new Date(),
        },
      };
    } catch (error) {
      if (error instanceof LoadError || error instanceof TokenLimitError) {
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new LoadError(filePath, 'File not found');
      }
      throw new LoadError(filePath, `Failed to read: ${(error as Error).message}`);
    }
  }

  /**
   * Load multiple files
   * @param filePaths - Array of file paths
   * @returns Combined loaded source
   */
  async loadFiles(filePaths: string[]): Promise<LoadedSource> {
    const files: FileInfo[] = [];
    let totalTokens = 0;

    for (const filePath of filePaths) {
      try {
        const stats = await stat(filePath);
        if (!stats.isFile()) continue;

        const ext = extname(filePath).toLowerCase();
        let content: string;

        // Route to appropriate parser
        if (ext === '.pdf') {
          content = await this.parsePdf(filePath);
        } else {
          content = await readFile(filePath, 'utf-8');
        }

        const tokenEstimate = this.estimateTokens(content);

        // Check cumulative limit
        if (totalTokens + tokenEstimate > this.maxTokens) {
          console.warn(`Skipping ${filePath}: would exceed token limit`);
          continue;
        }

        files.push({
          path: basename(filePath),
          content,
          size: stats.size,
          tokenEstimate,
          mimeType: this.getMimeType(ext),
        });

        totalTokens += tokenEstimate;
      } catch {
        console.warn(`Skipping ${filePath}: failed to read`);
      }
    }

    if (files.length === 0) {
      throw new LoadError(filePaths.join(', '), 'No files could be loaded');
    }

    return {
      content: this.buildCombinedContent(files),
      totalTokens,
      fileCount: files.length,
      files,
      metadata: {
        source: `${files.length} files`,
        loadedAt: new Date(),
      },
    };
  }

  /**
   * Load all document files from a directory (markdown, PDF, text)
   * @param dirPath - Directory path
   * @param recursive - Whether to search recursively
   * @returns Combined loaded source
   */
  async loadMarkdownDirectory(
    dirPath: string,
    recursive = true
  ): Promise<LoadedSource> {
    const files: FileInfo[] = [];
    let totalTokens = 0;

    await this.collectDocumentFiles(dirPath, files, totalTokens, recursive);

    if (files.length === 0) {
      throw new LoadError(dirPath, 'No document files found');
    }

    // Recalculate total
    totalTokens = files.reduce((sum, f) => sum + f.tokenEstimate, 0);

    return {
      content: this.buildCombinedContent(files),
      totalTokens,
      fileCount: files.length,
      files,
      metadata: {
        source: dirPath,
        loadedAt: new Date(),
      },
    };
  }

  /**
   * Recursively collect document files (markdown, PDF, text)
   */
  private async collectDocumentFiles(
    dirPath: string,
    files: FileInfo[],
    currentTokens: number,
    recursive: boolean
  ): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory() && recursive) {
        // Skip common non-doc directories
        if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        await this.collectDocumentFiles(fullPath, files, currentTokens, recursive);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (['.md', '.mdx', '.txt', '.rst', '.pdf'].includes(ext)) {
          try {
            let content: string;

            // Parse PDFs, read text files directly
            if (ext === '.pdf') {
              content = await this.parsePdf(fullPath);
            } else {
              content = await readFile(fullPath, 'utf-8');
            }

            const tokenEstimate = this.estimateTokens(content);

            if (currentTokens + tokenEstimate > this.maxTokens) {
              console.warn(`Skipping ${fullPath}: would exceed token limit`);
              continue;
            }

            const stats = await stat(fullPath);
            files.push({
              path: fullPath,
              content,
              size: stats.size,
              tokenEstimate,
              mimeType: this.getMimeType(ext),
            });

            currentTokens += tokenEstimate;
          } catch {
            console.warn(`Skipping ${fullPath}: failed to read`);
          }
        }
      }
    }
  }

  /**
   * Load content from a string (for programmatic use)
   * @param content - The content string
   * @param name - A name for this content
   * @returns Loaded source
   */
  loadString(content: string, name = 'content'): LoadedSource {
    const tokenEstimate = this.estimateTokens(content);

    if (tokenEstimate > this.maxTokens) {
      throw new TokenLimitError(tokenEstimate, this.maxTokens);
    }

    const file: FileInfo = {
      path: name,
      content,
      size: content.length,
      tokenEstimate,
      mimeType: 'text/plain',
    };

    return {
      content,
      totalTokens: tokenEstimate,
      fileCount: 1,
      files: [file],
      metadata: {
        source: name,
        loadedAt: new Date(),
      },
    };
  }

  /**
   * Parse PDF file and extract text content
   * @param filePath - Path to PDF file
   * @returns Extracted text content
   */
  private async parsePdf(filePath: string): Promise<string> {
    try {
      const buffer = await readFile(filePath);
      const uint8Array = new Uint8Array(buffer);

      // Initialize PDF.js (required for Cloudflare Workers compatibility)
      const { getDocument } = await resolvePDFJS();

      // Load the PDF document
      const doc = await getDocument({
        data: uint8Array,
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
      }).promise;

      const textParts: string[] = [];
      const numPages = doc.numPages;

      // Extract text from each page
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Combine text items from the page
        const pageText = textContent.items
          .map((item: any) => {
            // Handle both TextItem and TextMarkedContent types
            return 'str' in item ? item.str : '';
          })
          .join(' ');

        if (pageText.trim()) {
          textParts.push(`\n--- Page ${pageNum} ---\n${pageText}`);
        }
      }

      const extractedText = textParts.join('\n\n');

      if (!extractedText.trim()) {
        throw new Error('No text content extracted from PDF');
      }

      return extractedText;
    } catch (error) {
      throw new LoadError(
        filePath,
        `Failed to parse PDF: ${(error as Error).message}`
      );
    }
  }

  /**
   * Wrap single file content
   */
  private wrapContent(file: FileInfo): string {
    const lines: string[] = [];
    lines.push(`# ${file.path}`);
    lines.push(`# Tokens: ~${file.tokenEstimate}`);
    lines.push('');
    lines.push(file.content);
    return lines.join('\n');
  }

  /**
   * Build combined content from multiple files
   */
  private buildCombinedContent(files: FileInfo[]): string {
    const lines: string[] = [];

    lines.push('# Document Collection');
    lines.push(`# Files: ${files.length}`);
    lines.push(`# Total tokens: ~${files.reduce((s, f) => s + f.tokenEstimate, 0)}`);
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Table of contents
    lines.push('## Contents');
    for (const file of files) {
      lines.push(`- ${file.path}`);
    }
    lines.push('');

    // File contents
    for (const file of files) {
      lines.push('---');
      lines.push(`## ${file.path}`);
      lines.push('');
      lines.push(file.content);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Estimate tokens
   */
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4); // More generous estimate for text
  }

  /**
   * Get MIME type
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.md': 'text/markdown',
      '.mdx': 'text/markdown',
      '.txt': 'text/plain',
      '.rst': 'text/x-rst',
      '.pdf': 'application/pdf',
      '.json': 'application/json',
    };
    return mimeTypes[ext] ?? 'text/plain';
  }
}
