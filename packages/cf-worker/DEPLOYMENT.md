# Deployment Guide

## Prerequisites

- Bun installed (`curl -fsSL https://bun.sh/install | bash`)
- Cloudflare account with Workers enabled
- Wrangler CLI configured (`bunx wrangler login`)

## Initial Setup

### 1. Configure Secrets

```bash
cd packages/cf-worker

# Required: Gemini API key
bunx wrangler secret put GEMINI_API_KEY
# Enter your Gemini API key when prompted

# Optional: Authentication token
bunx wrangler secret put MNEMO_AUTH_TOKEN
# Enter a strong random token (e.g., generated with: openssl rand -base64 32)
```

### 2. Deploy

```bash
# From repository root
bun run deploy

# Or from packages/cf-worker directory
bunx wrangler deploy
```

## Verifying Deployment

### Test Health Endpoint (Public)

```bash
curl https://mnemo.logosflux.io/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "mnemo",
  "version": "0.1.0",
  "environment": "production"
}
```

### Test Protected Endpoint

#### Without Authentication (if MNEMO_AUTH_TOKEN is set)

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_list \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response (401):
```json
{
  "error": "Unauthorized",
  "message": "Missing Authorization header. Use: Authorization: Bearer <token>"
}
```

#### With Authentication

```bash
curl -X POST https://mnemo.logosflux.io/tools/context_list \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{}'
```

## Updating Authentication

### Change the Auth Token

```bash
bunx wrangler secret put MNEMO_AUTH_TOKEN
# Enter new token
```

Changes take effect immediately (no redeployment needed).

### Remove Authentication

```bash
bunx wrangler secret delete MNEMO_AUTH_TOKEN
```

This will make all endpoints publicly accessible again.

## Monitoring

### View Logs

```bash
bunx wrangler tail
```

### Check Secrets

```bash
bunx wrangler secret list
```

## Troubleshooting

### Authentication Always Fails

1. Verify secret is set: `bunx wrangler secret list`
2. Check token format: Must use `Authorization: Bearer <token>` header
3. Ensure no extra whitespace in token
4. Try deleting and re-adding the secret

### Endpoints Return 500 Errors

1. Check GEMINI_API_KEY is set and valid
2. View logs: `bunx wrangler tail`
3. Verify D1 database is accessible
4. Check R2 bucket permissions

## Security Best Practices

1. **Rotate tokens regularly**: Update MNEMO_AUTH_TOKEN every 90 days
2. **Use strong tokens**: Generate with `openssl rand -base64 32`
3. **Monitor usage**: Review logs for unauthorized access attempts
4. **Restrict by IP** (optional): Add Cloudflare firewall rules
5. **Enable WAF** (optional): Cloudflare Web Application Firewall

## Related Documentation

- [Authentication Guide](./AUTH.md)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/)
