# Mnemo

Extended memory for AI assistants via [Gemini context caching](https://raw.githubusercontent.com/Logos-Flux/mnemo/refs/heads/main/you%20hold%20contex.jpg).

**Mnemo** (Greek: memory) gives AI assistants like Claude access to large codebases, documentation sites, PDFs, and more by leveraging Gemini's 1M token context window and context caching features.

## Why Mnemo?

Instead of complex RAG pipelines with embeddings and retrieval, Mnemo takes a simpler approach:
- Load your entire codebase into Gemini's context cache
- Query it with natural language
- Let Claude orchestrate while Gemini holds the context

This gives you:
- **Perfect recall** - no chunking or retrieval means no lost context
- **Lower latency** - cached context is served quickly
- **Cost savings** - cached tokens cost 75-90% less than regular input tokens
- **Simplicity** - no vector databases, embeddings, or complex retrieval logic

## What Can Mnemo Load?

| Source | Local Server | Worker |
|--------|--------------|--------|
| GitHub repos (public) | ✅ | ✅ |
| GitHub repos (private) | ✅ | ✅ |
| Any URL (docs, articles) | ✅ | ✅ |
| PDF documents | ✅ | ✅ |
| JSON APIs | ✅ | ✅ |
| Local files/directories | ✅ | ❌ |
| Multi-page crawls | ✅ unlimited | ✅ 40 pages max |

## Deployment Options

Mnemo can be deployed in three ways depending on your needs.

### Option 1: Local Server (Development & Full Features)

Best for development and when you need to load local files.

```bash
# Clone and install
git clone https://github.com/logos-flux/mnemo
cd mnemo
bun install

# Set your Gemini API key
export GEMINI_API_KEY=your_key_here

# Start the server
bun run dev
```

**Claude Code MCP config:**
```json
{
  "mcpServers": {
    "mnemo": {
      "type": "http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

---

### Option 2: Self-Hosted Cloudflare Worker (Recommended for Claude.ai)

Deploy to your own Cloudflare account. You control your data and costs.

**Prerequisites:**
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Gemini API key](https://aistudio.google.com/apikey)

```bash
# Clone and install
git clone https://github.com/logos-flux/mnemo
cd mnemo/packages/cf-worker

# Configure secrets
bunx wrangler secret put GEMINI_API_KEY
bunx wrangler secret put MNEMO_AUTH_TOKEN  # Optional but recommended

# Create D1 database
bunx wrangler d1 create mnemo-cache

# Deploy
bunx wrangler deploy
```

**Claude.ai MCP config:**
```json
{
  "mcpServers": {
    "mnemo": {
      "type": "http",
      "url": "https://mnemo.<your-subdomain>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_AUTH_TOKEN"
      }
    }
  }
}
```

**Why use this?** Claude.ai can't connect to localhost. The Worker gives you an external endpoint that Claude.ai can reach.

---

### Option 3: Managed Hosting (VIP)

Don't want to manage infrastructure? We offer fully managed Mnemo hosting for select clients.

**Demo instance:** `https://mnemo.logosflux.io` (contact us for access)

**Includes:**
- Dedicated Worker deployment
- Priority support
- Custom domain
- Usage monitoring

**Contact:** [Voltage Labs](https://voltagelabs.dev) for pricing and availability.

---

## Usage Examples

```bash
# Load a GitHub repo
curl -X POST http://localhost:8080/tools/context_load \
  -H "Content-Type: application/json" \
  -d '{"source": "https://github.com/honojs/hono", "alias": "hono"}'

# Load a documentation site (crawls up to token target)
curl -X POST http://localhost:8080/tools/context_load \
  -H "Content-Type: application/json" \
  -d '{"source": "https://hono.dev/docs", "alias": "hono-docs"}'

# Load a PDF
curl -X POST http://localhost:8080/tools/context_load \
  -H "Content-Type: application/json" \
  -d '{"source": "https://arxiv.org/pdf/2303.08774.pdf", "alias": "gpt4-paper"}'

# Load a private repo (with GitHub token)
curl -X POST http://localhost:8080/tools/context_load \
  -H "Content-Type: application/json" \
  -d '{"source": "https://github.com/owner/private-repo", "alias": "private", "githubToken": "ghp_xxx"}'

# Load multiple sources into one cache
curl -X POST http://localhost:8080/tools/context_load \
  -H "Content-Type: application/json" \
  -d '{"sources": ["https://github.com/owner/repo", "https://docs.example.com"], "alias": "combined"}'

# Query the cache
curl -X POST http://localhost:8080/tools/context_query \
  -H "Content-Type: application/json" \
  -d '{"alias": "hono", "query": "How do I add middleware?"}'

# List active caches
curl -X POST http://localhost:8080/tools/context_list \
  -H "Content-Type: application/json" -d '{}'

# Get usage stats with cost tracking
curl -X POST http://localhost:8080/tools/context_stats \
  -H "Content-Type: application/json" -d '{}'

# Evict when done
curl -X POST http://localhost:8080/tools/context_evict \
  -H "Content-Type: application/json" \
  -d '{"alias": "hono"}'
```

### CLI

```bash
# Start server
mnemo serve

# Start MCP stdio transport (for Claude Desktop)
mnemo stdio

# Load a project
mnemo load ./my-project my-proj

# Query
mnemo query my-proj "What's the main entry point?"

# List caches
mnemo list

# Remove cache
mnemo evict my-proj
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `context_load` | Load GitHub repos, URLs, PDFs, or local dirs into Gemini cache |
| `context_query` | Query a cached context with natural language |
| `context_list` | List all active caches with token counts and expiry |
| `context_evict` | Remove a cache |
| `context_stats` | Get usage statistics with cost tracking |
| `context_refresh` | Reload a cache with fresh content |

### context_load Parameters

| Parameter | Description |
|-----------|-------------|
| `source` | Single source: GitHub URL, any URL, or local path |
| `sources` | Multiple sources to combine into one cache |
| `alias` | Friendly name for this cache (1-64 chars) |
| `ttl` | Time to live in seconds (60-86400, default 3600) |
| `githubToken` | GitHub token for private repos |
| `systemInstruction` | Custom system prompt for queries |

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Your Gemini API key | Required |
| `MNEMO_PORT` | Server port (local only) | 8080 |
| `MNEMO_DIR` | Data directory (local only) | ~/.mnemo |
| `MNEMO_AUTH_TOKEN` | Auth token for protected endpoints | None |

## Authentication

When `MNEMO_AUTH_TOKEN` is configured, the `/mcp` and `/tools/*` endpoints require authentication:

```bash
# Set auth token (Workers)
bunx wrangler secret put MNEMO_AUTH_TOKEN

# Requests must include header:
Authorization: Bearer your-token-here
```

Public endpoints (no auth required):
- `GET /health` - Health check
- `GET /` - Service info
- `GET /tools` - List available tools

## Costs

**You always pay for Gemini API usage** regardless of deployment option. Mnemo uses Gemini's context caching which is significantly cheaper than standard input:

| Resource | Cost |
|----------|------|
| Cache storage | ~$4.50 per 1M tokens per hour |
| Cached input | 75-90% discount vs regular input |
| Regular input | ~$0.075 per 1M tokens (Flash) |

**Example:** 100K token codebase cached for 1 hour with 10 queries ≈ $0.47

**Cloudflare costs (self-hosted):**
- Workers: Free tier includes 100K requests/day
- D1: Free tier includes 5M reads/day
- Likely $0 for moderate usage

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Mnemo                                │
├─────────────────────────────────────────────────────────────┤
│  MCP Tools                                                   │
│  • context_load    - Load into Gemini cache                 │
│  • context_query   - Query cached context                   │
│  • context_list    - Show active caches                     │
│  • context_evict   - Remove cache                           │
│  • context_stats   - Token usage, costs                     │
│  • context_refresh - Reload cache                           │
├─────────────────────────────────────────────────────────────┤
│  Adapters (v0.2)                                             │
│  • GitHub repos (via API)                                   │
│  • URL loading (HTML, PDF, JSON, text)                      │
│  • Token-targeted crawling                                  │
│  • robots.txt compliance                                    │
├─────────────────────────────────────────────────────────────┤
│  Packages                                                    │
│  • @mnemo/core      - Gemini client, loaders, adapters      │
│  • @mnemo/mcp-server - MCP protocol handling                │
│  • @mnemo/cf-worker - Cloudflare Workers deployment         │
│  • @mnemo/local     - Bun-based local server                │
└─────────────────────────────────────────────────────────────┘
```

## License

MIT

## Credits

Built by [Logos Flux](https://github.com/Logos-Flux) | [Voltage Labs](https://voltagelabs.dev)
