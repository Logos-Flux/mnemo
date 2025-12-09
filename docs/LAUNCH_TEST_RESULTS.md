# Mnemo v0.2.0 - Launch Test Results

**Date:** December 9, 2025
**Worker Version:** `a5b4c441-7e06-4b64-8b02-9f3b2f29ef5c`
**Tested by:** Claude (via claude.ai MCP integration)

---

## Test Summary

| Test | Status | Notes |
|------|--------|-------|
| PDF | ✅ PASS | 71K tokens from GPT-4 paper, query worked perfectly |
| HTML (single page) | ✅ PASS | Verified with Wikipedia |
| HTML (docs crawl) | ✅ PASS | Hono docs loaded 36K tokens |
| HTML (large docs) | ⚠️ LIMIT | Anthropic docs hits subrequest limit (expected) |
| JSON | ✅ PASS | Verified with JSONPlaceholder |
| GitHub repos | ✅ PASS | Hono repo loaded 616K tokens |
| GitHub API URLs | ⚠️ MINOR | Still rejected, not blocking |

---

## Launch Readiness: ✅ GO

### Core Functionality (All Working)

- **PDF loading** — Critical fix with `unpdf` library
- **HTML extraction** — Single pages and reasonable crawls
- **JSON formatting** — Structure summary + pretty print
- **GitHub repos** — Existing functionality intact

### Known Limitations (Documented)

1. **Large docs sites** — Cloudflare Workers have a 50 subrequest limit
   - Crawler stops at 40 subrequests to leave headroom
   - Returns partial results with metadata indicating limit was hit
   - **Workaround:** Use local server for large crawls

2. **GitHub API URLs** — `api.github.com` URLs currently rejected
   - Minor edge case, not blocking
   - Can be fixed post-launch

---

## Fixes Implemented for Launch

| Fix | Description |
|-----|-------------|
| PDF extraction | Replaced `pdf-parse` with `unpdf` for Workers compatibility |
| Subrequest limit | Added `maxSubrequests: 40` config for Workers |
| GitHub URL detection | Updated to exclude `api.github.com` |
| Wrangler | Updated to v4.53.0 |

---

## Capability Matrix

| Feature | Local Server | Worker Server |
|---------|--------------|---------------|
| Load local filesystem paths | ✅ | ❌ |
| Load GitHub repos (public) | ✅ | ✅ |
| Load GitHub repos (private) | ✅ (with token) | ✅ (with token) |
| Load arbitrary URLs | ✅ | ✅ |
| Load PDFs | ✅ | ✅ |
| Multi-page crawl | ✅ (unlimited) | ✅ (40 page limit) |
| Query cached context | ✅ | ✅ |
| List caches | ✅ | ✅ |
| Evict caches | ✅ | ✅ |
| Usage statistics | ✅ | ✅ |

---

## Production URLs

- **Primary:** https://mnemo.logosflux.io
- **Health:** https://mnemo.logosflux.io/health
- **Tools:** https://mnemo.logosflux.io/tools
