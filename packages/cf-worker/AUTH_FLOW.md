# Authentication Flow Diagram

## Request Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Incoming Request                         │
│                    (POST /mcp or /tools/*)                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
                  ┌─────────────────────────┐
                  │  requireAuth() Middleware │
                  └────────────┬──────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ MNEMO_AUTH_TOKEN set? │
                    └──────┬───────────┬────┘
                           │           │
                    NO ◄───┘           └───► YES
                     │                       │
                     ▼                       ▼
            ┌────────────────┐   ┌──────────────────────────┐
            │  Allow Access  │   │ Authorization header set? │
            └───────┬────────┘   └──────┬───────────────┬────┘
                    │                   │               │
                    │            NO ◄───┘               └───► YES
                    │             │                           │
                    │             ▼                           ▼
                    │   ┌────────────────────┐   ┌───────────────────┐
                    │   │  401 Unauthorized  │   │ Token matches?     │
                    │   │ "Missing header"   │   └──┬────────────┬───┘
                    │   └────────────────────┘      │            │
                    │                        NO ◄───┘            └───► YES
                    │                         │                        │
                    │                         ▼                        │
                    │               ┌────────────────────┐             │
                    │               │  401 Unauthorized  │             │
                    │               │  "Invalid token"   │             │
                    │               └────────────────────┘             │
                    │                                                  │
                    └──────────────────────┬───────────────────────────┘
                                           │
                                           ▼
                                  ┌────────────────┐
                                  │  Route Handler │
                                  │ (Execute tool) │
                                  └────────┬───────┘
                                           │
                                           ▼
                                  ┌────────────────┐
                                  │  200 Response  │
                                  │  (JSON result) │
                                  └────────────────┘
```

## Endpoint Protection Matrix

| Endpoint              | Method | Protected? | Public? | Notes                           |
|-----------------------|--------|------------|---------|----------------------------------|
| `/health`             | GET    | No         | Yes     | Always accessible                |
| `/`                   | GET    | No         | Yes     | Service info                     |
| `/tools`              | GET    | No         | Yes     | List available tools             |
| `/mcp`                | POST   | Yes        | No      | Requires auth if token is set    |
| `/tools/:toolName`    | POST   | Yes        | No      | Requires auth if token is set    |

## Authentication States

### State 1: No Token Configured
```
MNEMO_AUTH_TOKEN = undefined
↓
All endpoints accessible (backwards compatible)
```

### State 2: Token Configured
```
MNEMO_AUTH_TOKEN = "secret-token-123"
↓
Public endpoints: /health, /, /tools (GET)
Protected endpoints: /mcp, /tools/:toolName
↓
Protected endpoints require:
  Authorization: Bearer secret-token-123
```

## Example Request/Response Flows

### Flow 1: Public Endpoint (Always Works)
```
GET /health HTTP/1.1
Host: mnemo.logosflux.io

↓

HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "ok",
  "service": "mnemo",
  "version": "0.1.0"
}
```

### Flow 2: Protected Endpoint - No Auth Header
```
POST /tools/context_list HTTP/1.1
Host: mnemo.logosflux.io
Content-Type: application/json

{}

↓

HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "Unauthorized",
  "message": "Missing Authorization header. Use: Authorization: Bearer <token>"
}
```

### Flow 3: Protected Endpoint - Invalid Token
```
POST /tools/context_list HTTP/1.1
Host: mnemo.logosflux.io
Content-Type: application/json
Authorization: Bearer wrong-token

{}

↓

HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "Unauthorized",
  "message": "Invalid authentication token"
}
```

### Flow 4: Protected Endpoint - Valid Token
```
POST /tools/context_list HTTP/1.1
Host: mnemo.logosflux.io
Content-Type: application/json
Authorization: Bearer secret-token-123

{}

↓

HTTP/1.1 200 OK
Content-Type: application/json

{
  "content": [
    {
      "type": "text",
      "text": "[]"
    }
  ]
}
```

## Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      Cloudflare Edge                         │
│  • DDoS Protection                                           │
│  • Rate Limiting (optional)                                  │
│  • WAF Rules (optional)                                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       TLS/HTTPS                              │
│  • Encrypted in transit                                      │
│  • Cloudflare-managed certificates                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Bearer Token Authentication                     │
│  • Middleware validates token                                │
│  • Token stored in Cloudflare Secrets (encrypted at rest)    │
│  • Case-insensitive Bearer prefix matching                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Application Logic                         │
│  • MCP request processing                                    │
│  • Gemini API integration                                    │
│  • D1/R2 storage access                                      │
└─────────────────────────────────────────────────────────────┘
```

## Token Lifecycle

```
┌──────────────┐
│ Generate     │  openssl rand -base64 32
│ Strong Token │  → "xK9mP2vL8qR5tY7uI3oA6sD4fG1hJ0z="
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Store in     │  wrangler secret put MNEMO_AUTH_TOKEN
│ CF Secrets   │  → Encrypted at rest in Cloudflare
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Deploy       │  wrangler deploy
│ Worker       │  → Secret bound to worker
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Use in       │  Authorization: Bearer xK9mP2vL8qR5tY7uI3oA6sD4fG1hJ0z=
│ Requests     │  → Token validated on each request
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Rotate       │  After 90 days (recommended)
│ (Optional)   │  → Generate new token, update secret
└──────────────┘
```
