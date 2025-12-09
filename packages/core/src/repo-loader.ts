import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname, basename } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { unzipSync } from 'fflate';
import type { FileInfo, LoadedSource, LoadOptions } from './types';
import { LoadError, TokenLimitError } from './types';

// File extensions to include by default
const DEFAULT_INCLUDE_EXTENSIONS = new Set([
  // Code
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.go',
  '.rs',
  '.java', '.kt', '.scala',
  '.c', '.cpp', '.h', '.hpp',
  '.rb',
  '.php',
  '.swift',
  '.cs',
  '.vue', '.svelte',
  // Config
  '.json', '.jsonc', '.yaml', '.yml', '.toml',
  '.env.example', '.env.local.example',
  // Docs
  '.md', '.mdx', '.txt', '.rst',
  // Web
  '.html', '.css', '.scss', '.sass', '.less',
  // Data
  '.sql', '.graphql', '.prisma',
  // Shell
  '.sh', '.bash', '.zsh',
  // Other
  '.xml', '.svg',
]);

// Files to always exclude
const ALWAYS_EXCLUDE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'vendor',
  '.idea',
  '.vscode',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.d.ts',
  '.DS_Store',
  'Thumbs.db',
];

/**
 * Load a local directory into a format suitable for Gemini caching
 */
export class RepoLoader {
  private ig: Ignore;
  private maxTokens: number;

  constructor(options: { maxTokens?: number } = {}) {
    this.ig = ignore();
    this.maxTokens = options.maxTokens ?? 900000;
    
    // Add default excludes
    this.ig.add(ALWAYS_EXCLUDE);
  }

  /**
   * Load a local directory
   * @param dirPath - Path to the directory
   * @param options - Load options
   * @returns Loaded source ready for caching
   */
  async loadDirectory(
    dirPath: string,
    options: Partial<LoadOptions> = {}
  ): Promise<LoadedSource> {
    // Check if directory exists
    try {
      const stats = await stat(dirPath);
      if (!stats.isDirectory()) {
        throw new LoadError(dirPath, 'Path is not a directory');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new LoadError(dirPath, 'Directory not found');
      }
      throw error;
    }

    // Load .gitignore if present
    await this.loadGitignore(dirPath);

    // Add custom exclude patterns
    if (options.excludePatterns) {
      this.ig.add(options.excludePatterns);
    }

    // Collect all files
    const files: FileInfo[] = [];
    await this.walkDirectory(dirPath, dirPath, files, options.includePatterns);

    // Check token limit
    const totalTokens = files.reduce((sum, f) => sum + f.tokenEstimate, 0);
    if (totalTokens > this.maxTokens) {
      throw new TokenLimitError(totalTokens, this.maxTokens);
    }

    // Build combined content
    const content = this.buildContent(files, dirPath);

    // Try to get git info
    const gitInfo = await this.getGitInfo(dirPath);

    return {
      content,
      totalTokens,
      fileCount: files.length,
      files,
      metadata: {
        source: dirPath,
        loadedAt: new Date(),
        gitCommit: gitInfo?.commit,
        branch: gitInfo?.branch,
      },
    };
  }

  /**
   * Load .gitignore patterns
   */
  private async loadGitignore(dirPath: string): Promise<void> {
    try {
      const gitignorePath = join(dirPath, '.gitignore');
      const content = await readFile(gitignorePath, 'utf-8');
      this.ig.add(content);
    } catch {
      // No .gitignore, that's fine
    }

    // Also check for .mnemoignore
    try {
      const mnemoignorePath = join(dirPath, '.mnemoignore');
      const content = await readFile(mnemoignorePath, 'utf-8');
      this.ig.add(content);
    } catch {
      // No .mnemoignore, that's fine
    }
  }

  /**
   * Recursively walk directory and collect files
   */
  private async walkDirectory(
    basePath: string,
    currentPath: string,
    files: FileInfo[],
    includePatterns?: string[]
  ): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = relative(basePath, fullPath);

      // Check if ignored
      if (this.ig.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.walkDirectory(basePath, fullPath, files, includePatterns);
      } else if (entry.isFile()) {
        // Check extension
        const ext = extname(entry.name).toLowerCase();
        const shouldInclude = includePatterns
          ? includePatterns.some(p => relativePath.match(new RegExp(p)))
          : DEFAULT_INCLUDE_EXTENSIONS.has(ext) || entry.name === 'Dockerfile' || entry.name === 'Makefile';

        if (shouldInclude) {
          try {
            const content = await readFile(fullPath, 'utf-8');
            const stats = await stat(fullPath);
            
            // Skip binary files (heuristic: check for null bytes)
            if (content.includes('\0')) {
              continue;
            }

            // Skip very large files
            if (stats.size > 500000) { // 500KB
              continue;
            }

            const tokenEstimate = this.estimateTokens(content);

            files.push({
              path: relativePath,
              content,
              size: stats.size,
              tokenEstimate,
              mimeType: this.getMimeType(ext),
            });
          } catch {
            // Skip files we can't read
          }
        }
      }
    }
  }

  /**
   * Build combined content with file markers
   */
  private buildContent(files: FileInfo[], sourcePath: string): string {
    const lines: string[] = [];
    
    // Header
    lines.push('# Repository Context');
    lines.push(`# Source: ${sourcePath}`);
    lines.push(`# Files: ${files.length}`);
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push('');
    
    // File tree
    lines.push('## File Structure');
    lines.push('```');
    for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
      lines.push(file.path);
    }
    lines.push('```');
    lines.push('');
    
    // File contents
    lines.push('## File Contents');
    lines.push('');
    
    for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
      const ext = extname(file.path).slice(1) || 'txt';
      lines.push(`### ${file.path}`);
      lines.push('```' + ext);
      lines.push(file.content);
      lines.push('```');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get git info if available
   */
  private async getGitInfo(dirPath: string): Promise<{
    commit?: string;
    branch?: string;
  } | null> {
    try {
      // Read HEAD
      const headPath = join(dirPath, '.git', 'HEAD');
      const head = await readFile(headPath, 'utf-8');
      
      let branch: string | undefined;
      let commit: string | undefined;
      
      if (head.startsWith('ref: ')) {
        // It's a branch reference
        const ref = head.slice(5).trim();
        branch = ref.replace('refs/heads/', '');
        
        // Get commit from ref
        try {
          const refPath = join(dirPath, '.git', ref);
          commit = (await readFile(refPath, 'utf-8')).trim();
        } catch {
          // Might be in packed-refs
        }
      } else {
        // Detached HEAD, it's the commit hash
        commit = head.trim();
      }

      return { commit, branch };
    } catch {
      return null;
    }
  }

  /**
   * Simple token estimation
   */
  private estimateTokens(content: string): number {
    // Rough estimate: 1 token ≈ 3.5 characters for code
    return Math.ceil(content.length / 3.5);
  }

  /**
   * Get MIME type from extension
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.js': 'text/javascript',
      '.jsx': 'text/javascript',
      '.json': 'application/json',
      '.md': 'text/markdown',
      '.py': 'text/x-python',
      '.go': 'text/x-go',
      '.rs': 'text/x-rust',
      '.html': 'text/html',
      '.css': 'text/css',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.sql': 'text/x-sql',
    };
    return mimeTypes[ext] ?? 'text/plain';
  }
}

/**
 * Check if a string is a URL
 */
export function isUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

/**
 * Check if a string is a GitHub repository URL
 * Only matches github.com repo URLs (not api.github.com or raw.githubusercontent.com)
 */
export function isGitHubUrl(source: string): boolean {
  try {
    const url = new URL(source);
    // Only match github.com repo URLs with at least owner/repo in the path
    return (
      (url.hostname === 'github.com' || url.hostname === 'www.github.com') &&
      /^\/[^/]+\/[^/]+/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Load a remote GitHub repository by cloning to a temp directory
 */
export async function loadGitHubRepo(
  repoUrl: string,
  options: Partial<LoadOptions> = {}
): Promise<LoadedSource> {
  // Parse GitHub URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new LoadError(repoUrl, 'Invalid GitHub URL');
  }

  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, '');

  // Create temp directory
  const { tmpdir } = await import('node:os');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const tempDir = await mkdtemp(join(tmpdir(), `mnemo-${repoName}-`));

  try {
    // Clone the repository
    const { spawn } = await import('node:child_process');

    await new Promise<void>((resolve, reject) => {
      const gitProcess = spawn('git', ['clone', '--depth', '1', repoUrl, tempDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      gitProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new LoadError(repoUrl, `Git clone failed: ${stderr}`));
        }
      });

      gitProcess.on('error', (err) => {
        reject(new LoadError(repoUrl, `Git clone failed: ${err.message}`));
      });
    });

    // Load the cloned directory
    const loader = new RepoLoader(options.maxTokens ? { maxTokens: options.maxTokens } : {});
    const result = await loader.loadDirectory(tempDir, options);

    // Update metadata to reflect original source
    result.metadata.source = repoUrl;
    result.metadata.originalSource = repoUrl;
    result.metadata.clonedFrom = `${owner}/${repoName}`;

    return result;
  } finally {
    // Clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export interface GitHubLoadOptions extends Partial<LoadOptions> {
  /** GitHub personal access token for private repos */
  githubToken?: string;
}

/**
 * Load a GitHub repository via API (works in CF Workers - no filesystem needed)
 * Supports private repos when a GitHub token is provided
 */
export async function loadGitHubRepoViaAPI(
  repoUrl: string,
  options: GitHubLoadOptions = {}
): Promise<LoadedSource> {
  // Parse GitHub URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new LoadError(repoUrl, 'Invalid GitHub URL');
  }

  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, '');

  // Extract branch/ref if specified in URL (e.g., /tree/main)
  const refMatch = repoUrl.match(/\/tree\/([^/]+)/);
  const ref = refMatch ? refMatch[1] : 'HEAD';

  // Download zipball from GitHub API
  const zipUrl = `https://api.github.com/repos/${owner}/${repoName}/zipball/${ref}`;

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'Mnemo/0.1.0',
  };

  // Add authorization header for private repos
  if (options.githubToken) {
    headers['Authorization'] = `Bearer ${options.githubToken}`;
  }

  const response = await fetch(zipUrl, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      const hint = options.githubToken ? '' : ' (if private, provide a GitHub token)';
      throw new LoadError(repoUrl, `Repository not found: ${owner}/${repoName}${hint}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new LoadError(repoUrl, `Access denied: ${owner}/${repoName} - check your GitHub token permissions`);
    }
    throw new LoadError(repoUrl, `GitHub API error: ${response.status} ${response.statusText}`);
  }

  // Get the zip data
  const zipData = new Uint8Array(await response.arrayBuffer());

  // Extract the zip
  const extracted = unzipSync(zipData);

  // Process files - GitHub zips have a root folder like "owner-repo-commitsha/"
  const files: FileInfo[] = [];
  const ig = ignore();
  ig.add(ALWAYS_EXCLUDE);

  // Find the root directory prefix (first entry is usually the root folder)
  let rootPrefix = '';
  for (const path of Object.keys(extracted)) {
    if (path.endsWith('/')) {
      rootPrefix = path;
      break;
    }
  }

  // Check for .gitignore in the archive
  const gitignorePath = rootPrefix + '.gitignore';
  if (extracted[gitignorePath]) {
    const gitignoreContent = new TextDecoder().decode(extracted[gitignorePath]);
    ig.add(gitignoreContent);
  }

  // Add custom exclude patterns
  if (options.excludePatterns) {
    ig.add(options.excludePatterns);
  }

  const maxTokens = options.maxTokens ?? 900000;
  let totalTokens = 0;

  for (const [path, data] of Object.entries(extracted)) {
    // Skip directories
    if (path.endsWith('/')) continue;

    // Get relative path (remove root prefix)
    const relativePath = path.startsWith(rootPrefix)
      ? path.slice(rootPrefix.length)
      : path;

    // Skip if ignored
    if (ig.ignores(relativePath)) continue;

    // Check extension
    const ext = extname(relativePath).toLowerCase();
    const fileName = basename(relativePath);
    const shouldInclude = options.includePatterns
      ? options.includePatterns.some(p => relativePath.match(new RegExp(p)))
      : DEFAULT_INCLUDE_EXTENSIONS.has(ext) || fileName === 'Dockerfile' || fileName === 'Makefile';

    if (!shouldInclude) continue;

    // Skip large files
    if (data.length > 500000) continue;

    // Decode content
    let content: string;
    try {
      content = new TextDecoder().decode(data);
    } catch {
      continue; // Skip files that can't be decoded as UTF-8
    }

    // Skip binary files (check for null bytes)
    if (content.includes('\0')) continue;

    const tokenEstimate = Math.ceil(content.length / 3.5);
    totalTokens += tokenEstimate;

    // Check token limit
    if (totalTokens > maxTokens) {
      throw new TokenLimitError(totalTokens, maxTokens);
    }

    const mimeTypes: Record<string, string> = {
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.js': 'text/javascript',
      '.jsx': 'text/javascript',
      '.json': 'application/json',
      '.md': 'text/markdown',
      '.py': 'text/x-python',
      '.go': 'text/x-go',
      '.rs': 'text/x-rust',
      '.html': 'text/html',
      '.css': 'text/css',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.sql': 'text/x-sql',
    };

    files.push({
      path: relativePath,
      content,
      size: data.length,
      tokenEstimate,
      mimeType: mimeTypes[ext] ?? 'text/plain',
    });
  }

  // Build combined content
  const lines: string[] = [];

  lines.push('# Repository Context');
  lines.push(`# Source: ${repoUrl}`);
  lines.push(`# Repository: ${owner}/${repoName}`);
  lines.push(`# Files: ${files.length}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## File Structure');
  lines.push('```');
  for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
    lines.push(file.path);
  }
  lines.push('```');
  lines.push('');

  lines.push('## File Contents');
  lines.push('');

  for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
    const ext = extname(file.path).slice(1) || 'txt';
    lines.push(`### ${file.path}`);
    lines.push('```' + ext);
    lines.push(file.content);
    lines.push('```');
    lines.push('');
  }

  return {
    content: lines.join('\n'),
    totalTokens,
    fileCount: files.length,
    files,
    metadata: {
      source: repoUrl,
      loadedAt: new Date(),
      originalSource: repoUrl,
      clonedFrom: `${owner}/${repoName}`,
    },
  };
}
