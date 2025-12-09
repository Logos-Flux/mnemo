-- Mnemo D1 Schema
-- Stores cache metadata and usage logs

-- Cache metadata table
CREATE TABLE IF NOT EXISTS caches (
  id TEXT PRIMARY KEY,
  alias TEXT UNIQUE NOT NULL,
  gemini_cache_name TEXT NOT NULL,
  source TEXT NOT NULL,
  token_count INTEGER DEFAULT 0,
  model TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  user_id TEXT,
  system_instruction TEXT
);

-- Index for alias lookups (most common)
CREATE INDEX IF NOT EXISTS idx_caches_alias ON caches(alias);

-- Index for expiry cleanup
CREATE INDEX IF NOT EXISTS idx_caches_expires ON caches(expires_at);

-- Index for user isolation (if multi-tenant)
CREATE INDEX IF NOT EXISTS idx_caches_user ON caches(user_id);

-- Usage logs table
-- Note: cache_id stores the Gemini cache name, not foreign key to caches.id
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_id TEXT,
  operation TEXT NOT NULL, -- 'load', 'query', 'evict'
  tokens_used INTEGER DEFAULT 0,
  cached_tokens_used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Index for cache usage aggregation
CREATE INDEX IF NOT EXISTS idx_usage_cache ON usage_logs(cache_id);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_logs(created_at);
