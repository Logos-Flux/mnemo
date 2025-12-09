import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  GeminiClient,
  type CacheStorage,
  type CacheMetadata,
  type CacheListItem,
  type UsageLogger,
  type UsageEntry,
  type UsageStats,
  type UsageOperation,
  MnemoConfigSchema,
  calculateCost,
} from '@mnemo/core';
import { MnemoMCPServer, toolDefinitions } from '@mnemo/mcp-server';

// ============================================================================
// Configuration
// ============================================================================

const PORT = parseInt(process.env.MNEMO_PORT ?? '8080');
const MNEMO_DIR = process.env.MNEMO_DIR ?? join(homedir(), '.mnemo');
const DB_PATH = join(MNEMO_DIR, 'mnemo.db');

// ============================================================================
// Initialization
// ============================================================================

async function init() {
  // Ensure directory exists
  await mkdir(MNEMO_DIR, { recursive: true });

  // Check for API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY environment variable is required');
    console.error('Get one at: https://aistudio.google.com/app/apikey');
    process.exit(1);
  }

  // Initialize database
  const db = new Database(DB_PATH);
  initDatabase(db);

  // Create services
  const config = MnemoConfigSchema.parse({ geminiApiKey: apiKey });
  const geminiClient = new GeminiClient(config);
  const storage = new SQLiteCacheStorage(db);
  const usageLogger = new SQLiteUsageLogger(db);
  const mcpServer = new MnemoMCPServer({ geminiClient, storage, usageLogger });

  return { db, mcpServer, storage, usageLogger };
}

function initDatabase(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS caches (
      id TEXT PRIMARY KEY,
      alias TEXT UNIQUE NOT NULL,
      gemini_cache_name TEXT NOT NULL,
      source TEXT NOT NULL,
      token_count INTEGER DEFAULT 0,
      model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_caches_alias ON caches(alias)`);

  // Usage logs table
  db.run(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_id TEXT,
      operation TEXT NOT NULL,
      tokens_used INTEGER DEFAULT 0,
      cached_tokens_used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_usage_cache ON usage_logs(cache_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_logs(created_at)`);
}

// ============================================================================
// SQLite Storage Implementation
// ============================================================================

class SQLiteCacheStorage implements CacheStorage {
  constructor(private db: Database) {}

  async save(metadata: CacheMetadata): Promise<void> {
    this.db.run(
      `INSERT INTO caches (id, alias, gemini_cache_name, source, token_count, model, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(alias) DO UPDATE SET
         gemini_cache_name = excluded.gemini_cache_name,
         source = excluded.source,
         token_count = excluded.token_count,
         model = excluded.model,
         expires_at = excluded.expires_at`,
      [
        crypto.randomUUID(),
        metadata.alias,
        metadata.name,
        metadata.source,
        metadata.tokenCount,
        metadata.model ?? null,
        metadata.expiresAt.toISOString(),
      ]
    );
  }

  async getByAlias(alias: string): Promise<CacheMetadata | null> {
    const result = this.db
      .query('SELECT * FROM caches WHERE alias = ?')
      .get(alias) as {
      id: string;
      alias: string;
      gemini_cache_name: string;
      source: string;
      token_count: number;
      model: string | null;
      created_at: string;
      expires_at: string;
    } | null;

    if (!result) return null;

    return {
      name: result.gemini_cache_name,
      alias: result.alias,
      tokenCount: result.token_count,
      createdAt: new Date(result.created_at),
      expiresAt: new Date(result.expires_at),
      source: result.source,
      model: result.model ?? undefined,
    };
  }

  async getByName(name: string): Promise<CacheMetadata | null> {
    const result = this.db
      .query('SELECT * FROM caches WHERE gemini_cache_name = ?')
      .get(name) as {
      id: string;
      alias: string;
      gemini_cache_name: string;
      source: string;
      token_count: number;
      model: string | null;
      created_at: string;
      expires_at: string;
    } | null;

    if (!result) return null;

    return {
      name: result.gemini_cache_name,
      alias: result.alias,
      tokenCount: result.token_count,
      createdAt: new Date(result.created_at),
      expiresAt: new Date(result.expires_at),
      source: result.source,
      model: result.model ?? undefined,
    };
  }

  async list(): Promise<CacheListItem[]> {
    const results = this.db
      .query('SELECT alias, token_count, expires_at, source FROM caches ORDER BY created_at DESC')
      .all() as Array<{
      alias: string;
      token_count: number;
      expires_at: string;
      source: string;
    }>;

    return results.map((row) => ({
      alias: row.alias,
      tokenCount: row.token_count,
      expiresAt: new Date(row.expires_at),
      source: row.source,
    }));
  }

  async deleteByAlias(alias: string): Promise<boolean> {
    const result = this.db.run('DELETE FROM caches WHERE alias = ?', [alias]);
    return result.changes > 0;
  }

  async update(alias: string, updates: Partial<CacheMetadata>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.expiresAt) {
      sets.push('expires_at = ?');
      values.push(updates.expiresAt.toISOString());
    }
    if (updates.tokenCount !== undefined) {
      sets.push('token_count = ?');
      values.push(updates.tokenCount);
    }

    if (sets.length === 0) return;

    values.push(alias);
    this.db.run(`UPDATE caches SET ${sets.join(', ')} WHERE alias = ?`, values as any);
  }
}

// ============================================================================
// SQLite Usage Logger Implementation
// ============================================================================

class SQLiteUsageLogger implements UsageLogger {
  constructor(private db: Database) {}

  async log(entry: Omit<UsageEntry, 'createdAt'>): Promise<void> {
    this.db.run(
      `INSERT INTO usage_logs (cache_id, operation, tokens_used, cached_tokens_used)
       VALUES (?, ?, ?, ?)`,
      [entry.cacheId, entry.operation, entry.tokensUsed, entry.cachedTokensUsed]
    );
  }

  async getStats(cacheId?: string): Promise<UsageStats> {
    const whereClause = cacheId ? 'WHERE cache_id = ?' : '';
    const params = cacheId ? [cacheId] : [];

    // Get totals
    const totals = this.db
      .query(
        `SELECT
          COUNT(*) as total_ops,
          COALESCE(SUM(tokens_used), 0) as total_tokens,
          COALESCE(SUM(cached_tokens_used), 0) as total_cached
         FROM usage_logs ${whereClause}`
      )
      .get(...params) as { total_ops: number; total_tokens: number; total_cached: number };

    // Get breakdown by operation
    const byOpRows = this.db
      .query(
        `SELECT
          operation,
          COUNT(*) as count,
          COALESCE(SUM(tokens_used), 0) as tokens_used,
          COALESCE(SUM(cached_tokens_used), 0) as cached_tokens_used
         FROM usage_logs ${whereClause}
         GROUP BY operation`
      )
      .all(...params) as Array<{
      operation: string;
      count: number;
      tokens_used: number;
      cached_tokens_used: number;
    }>;

    const byOperation: Record<UsageOperation, { count: number; tokensUsed: number; cachedTokensUsed: number }> = {
      load: { count: 0, tokensUsed: 0, cachedTokensUsed: 0 },
      query: { count: 0, tokensUsed: 0, cachedTokensUsed: 0 },
      evict: { count: 0, tokensUsed: 0, cachedTokensUsed: 0 },
      refresh: { count: 0, tokensUsed: 0, cachedTokensUsed: 0 },
    };

    for (const row of byOpRows) {
      const op = row.operation as UsageOperation;
      if (op in byOperation) {
        byOperation[op] = {
          count: row.count,
          tokensUsed: row.tokens_used,
          cachedTokensUsed: row.cached_tokens_used,
        };
      }
    }

    return {
      totalOperations: totals.total_ops,
      totalTokensUsed: totals.total_tokens,
      totalCachedTokensUsed: totals.total_cached,
      estimatedCost: calculateCost(totals.total_tokens, totals.total_cached),
      byOperation,
    };
  }

  async getRecent(limit = 100): Promise<UsageEntry[]> {
    const rows = this.db
      .query(
        `SELECT cache_id, operation, tokens_used, cached_tokens_used, created_at
         FROM usage_logs
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      cache_id: string;
      operation: string;
      tokens_used: number;
      cached_tokens_used: number;
      created_at: string;
    }>;

    return rows.map((row) => ({
      cacheId: row.cache_id,
      operation: row.operation as UsageOperation,
      tokensUsed: row.tokens_used,
      cachedTokensUsed: row.cached_tokens_used,
      createdAt: new Date(row.created_at),
    }));
  }
}

// ============================================================================
// Server
// ============================================================================

async function main() {
  const { mcpServer } = await init();

  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.use('*', logger());

  // Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'mnemo-local',
      version: '0.1.0',
    });
  });

  // Service info
  app.get('/', (c) => {
    return c.json({
      name: 'mnemo',
      version: '0.1.0',
      description: 'Extended memory for AI assistants via Gemini context caching',
      mode: 'local',
      endpoints: {
        health: 'GET /health',
        tools: 'GET /tools',
        mcp: 'POST /mcp',
      },
    });
  });

  // List available tools
  app.get('/tools', (c) => {
    return c.json({ tools: toolDefinitions });
  });

  // MCP protocol endpoint
  app.post('/mcp', async (c) => {
    try {
      const request = await c.req.json();
      const response = await mcpServer.handleRequest(request);
      return c.json(response);
    } catch (error) {
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: 'Parse error',
          },
        },
        400
      );
    }
  });

  // Direct tool invocation
  app.post('/tools/:toolName', async (c) => {
    const toolName = c.req.param('toolName');
    try {
      const args = await c.req.json();
      const response = await mcpServer.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      });

      if ('result' in response && response.result) {
        return c.json(response.result);
      }
      if ('error' in response && response.error) {
        return c.json({ error: response.error.message }, 400);
      }
      return c.json(response);
    } catch {
      return c.json({ error: 'Invalid request' }, 400);
    }
  });

  // Logos Flux Banner with Mnemo branding
  const BRIGHT_MAGENTA = '\x1b[95m';
  const MAGENTA = '\x1b[35m';
  const CYAN = '\x1b[36m';
  const BRIGHT_CYAN = '\x1b[96m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';

  console.log('');
  console.log(`${BRIGHT_MAGENTA}        ██╗      ██████╗  ██████╗  ██████╗ ███████╗${RESET}`);
  console.log(`${BRIGHT_MAGENTA}        ██║     ██╔═══██╗██╔════╝ ██╔═══██╗██╔════╝${RESET}`);
  console.log(`${MAGENTA}        ██║     ██║   ██║██║  ███╗██║   ██║███████╗${RESET}`);
  console.log(`${MAGENTA}        ██║     ██║   ██║██║   ██║██║   ██║╚════██║${RESET}`);
  console.log(`${MAGENTA}        ███████╗╚██████╔╝╚██████╔╝╚██████╔╝███████║${RESET}`);
  console.log(`${MAGENTA}        ╚══════╝ ╚═════╝  ╚═════╝  ╚═════╝ ╚══════╝${RESET}`);
  console.log('');
  console.log(`${BRIGHT_CYAN}                ███████╗██╗     ██╗   ██╗██╗  ██╗${RESET}`);
  console.log(`${BRIGHT_CYAN}                ██╔════╝██║     ██║   ██║╚██╗██╔╝${RESET}`);
  console.log(`${CYAN}                █████╗  ██║     ██║   ██║ ╚███╔╝ ${RESET}`);
  console.log(`${CYAN}                ██╔══╝  ██║     ██║   ██║ ██╔██╗ ${RESET}`);
  console.log(`${CYAN}                ██║     ███████╗╚██████╔╝██╔╝ ██╗${RESET}`);
  console.log(`${CYAN}                ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝${RESET}`);
  console.log('');
  console.log(`${DIM}                           Φ⥁○⧖∵${RESET}`);
  console.log('');
  console.log(`${DIM}                    ⚡ Mnemo v0.2.0 ⚡${RESET}`);
  console.log('');
  console.log(`${DIM}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${DIM}║${RESET}  ${BRIGHT_CYAN}Extended memory for AI assistants${RESET}                      ${DIM}║${RESET}`);
  console.log(`${DIM}╠══════════════════════════════════════════════════════════╣${RESET}`);
  console.log(`${DIM}║${RESET}  Server:    ${BRIGHT_MAGENTA}http://localhost:${PORT}${RESET}                        ${DIM}║${RESET}`);
  console.log(`${DIM}║${RESET}  Data:      ${CYAN}${MNEMO_DIR}${RESET}`);
  console.log(`${DIM}║${RESET}  MCP:       ${CYAN}POST /mcp${RESET}                                   ${DIM}║${RESET}`);
  console.log(`${DIM}║${RESET}  Tools:     ${CYAN}GET /tools${RESET}                                  ${DIM}║${RESET}`);
  console.log(`${DIM}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  Bun.serve({
    port: PORT,
    fetch: app.fetch,
  });
}

main().catch(console.error);
