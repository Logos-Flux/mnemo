# Mnemo Live Testing Checklist

**Live URL:** https://mnemo.logosflux.io

## Prerequisites

- A public GitHub repo to test with (e.g., `https://github.com/logos-flux/mnemo`)
- (Optional) A private GitHub repo and personal access token
- curl or similar HTTP client

---

## Test 1: Health Check

```bash
curl https://mnemo.logosflux.io/health
```

**Expected:**
```json
{"status":"ok","service":"mnemo","version":"0.1.0","environment":"production"}
```

---

## Test 2: List Tools

```bash
curl https://mnemo.logosflux.io/tools
```

**Expected:** JSON with 5 tools: `context_load`, `context_query`, `context_list`, `context_evict`, `context_stats`

---

## Test 3: Load a Public GitHub Repo

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_load \
  -H "Content-Type: application/json" \
  -d '{
    "source": "https://github.com/logos-flux/mnemo",
    "alias": "test-repo"
  }'
```

**Expected:** Success with cache metadata including `tokenCount` and `expiresAt`

---

## Test 4: Query the Cache

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_query \
  -H "Content-Type: application/json" \
  -d '{
    "alias": "test-repo",
    "query": "What is this project and what are its main features?"
  }'
```

**Expected:** A coherent response about Mnemo based on the cached content

---

## Test 5: List Active Caches

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_list \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** List containing "test-repo" with token count and expiry

---

## Test 6: Get Usage Statistics

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_stats \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** Stats including:
- `totalCaches`: 1+
- `totalTokens`: > 0
- `usage.totalOperations`: 2+ (load + query)
- `usage.estimatedCost`: > 0

---

## Test 7: Composite Loading (NEW)

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_load \
  -H "Content-Type: application/json" \
  -d '{
    "sources": [
      "https://github.com/logos-flux/mnemo",
      "https://github.com/yamadashy/repomix"
    ],
    "alias": "combined-test"
  }'
```

**Expected:**
- `success: true`
- `sourcesLoaded: 2`
- `cache.source` contains both repo names with "+"

---

## Test 8: Query Combined Cache

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_query \
  -H "Content-Type: application/json" \
  -d '{
    "alias": "combined-test",
    "query": "Compare these two projects. What do they have in common?"
  }'
```

**Expected:** Response that references both Mnemo and Repomix

---

## Test 9: Private Repo (if you have one)

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_load \
  -H "Content-Type: application/json" \
  -d '{
    "source": "https://github.com/YOUR_ORG/private-repo",
    "alias": "private-test",
    "githubToken": "ghp_YOUR_TOKEN_HERE"
  }'
```

**Expected:** Success (or 403 error message about token permissions if token is wrong)

---

## Test 10: Evict Cache

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_evict \
  -H "Content-Type: application/json" \
  -d '{"alias": "test-repo"}'
```

**Expected:** `{"success": true, "alias": "test-repo"}`

---

## Test 11: Verify Eviction

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_query \
  -H "Content-Type: application/json" \
  -d '{
    "alias": "test-repo",
    "query": "test"
  }'
```

**Expected:** Error: "Cache not found: test-repo"

---

## Test 12: MCP Protocol (JSON-RPC)

```bash
curl -X POST https://mnemo.logosflux.io/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize"
  }'
```

**Expected:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": {"name": "mnemo", "version": "0.1.0"},
    "capabilities": {"tools": {}}
  }
}
```

---

## Cleanup

After testing, clean up any remaining caches:

```bash
# List remaining caches
curl -X POST https://mnemo.logosflux.io/tools/context_list \
  -H "Content-Type: application/json" -d '{}'

# Evict each one
curl -X POST https://mnemo.logosflux.io/tools/context_evict \
  -H "Content-Type: application/json" \
  -d '{"alias": "combined-test"}'
```

---

## Success Criteria

- [ ] Health check returns ok
- [ ] All 5 tools are listed
- [ ] Can load a public GitHub repo
- [ ] Can query the cached content
- [ ] Cache appears in list
- [ ] Stats show usage with cost estimate
- [ ] Composite loading works with multiple sources
- [ ] Can query combined context
- [ ] Eviction removes the cache
- [ ] MCP protocol responds correctly
