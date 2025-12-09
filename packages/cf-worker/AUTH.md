# Authentication

The Mnemo Cloudflare Worker supports optional Bearer token authentication.

## Configuration

### 1. Set the authentication token (optional)

```bash
# Using wrangler CLI
wrangler secret put MNEMO_AUTH_TOKEN
# Enter your secret token when prompted

# Or use environment variable for local development
export MNEMO_AUTH_TOKEN=your-secret-token-here
```

### 2. Behavior

- **If `MNEMO_AUTH_TOKEN` is NOT configured**: All endpoints are publicly accessible (backwards compatible)
- **If `MNEMO_AUTH_TOKEN` IS configured**: Protected endpoints require authentication

## Protected Endpoints

When authentication is enabled, these endpoints require a valid Bearer token:

- `POST /mcp` - MCP protocol endpoint
- `POST /tools/:toolName` - Direct tool invocation endpoints

## Public Endpoints

These endpoints are ALWAYS public (no authentication required):

- `GET /health` - Health check
- `GET /` - Service information
- `GET /tools` - List available tools

## Making Authenticated Requests

Include the `Authorization` header with your Bearer token:

```bash
# Example: Load a GitHub repo with authentication
curl -X POST https://mnemo.logosflux.io/tools/context_load \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token-here" \
  -d '{
    "source": "https://github.com/user/repo",
    "alias": "my-repo"
  }'

# Example: Query cached context
curl -X POST https://mnemo.logosflux.io/tools/context_query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token-here" \
  -d '{
    "alias": "my-repo",
    "query": "What does this codebase do?"
  }'
```

## Error Responses

### Missing Authorization Header

```json
{
  "error": "Unauthorized",
  "message": "Missing Authorization header. Use: Authorization: Bearer <token>"
}
```

HTTP Status: `401 Unauthorized`

### Invalid Token

```json
{
  "error": "Unauthorized",
  "message": "Invalid authentication token"
}
```

HTTP Status: `401 Unauthorized`

## Security Recommendations

1. **Use strong, random tokens**: Generate tokens with sufficient entropy (e.g., `openssl rand -base64 32`)
2. **Rotate tokens regularly**: Update the secret periodically
3. **Use HTTPS**: The worker runs on `https://` by default - never disable this
4. **Store tokens securely**: Use Cloudflare secrets (never commit to git)

## Implementation Details

The authentication middleware:
- Uses case-insensitive Bearer token matching (accepts both `Bearer` and `bearer`)
- Strips the `Bearer ` prefix before comparing tokens
- Performs constant-time string comparison (via JavaScript's `!==` operator)
- Returns detailed error messages for easier debugging
