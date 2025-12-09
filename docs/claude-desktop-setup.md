# Claude Desktop Integration

Mnemo can be used with Claude Desktop via the MCP stdio transport.

## Setup

### 1. Install Mnemo locally

```bash
cd packages/local
bun install
```

### 2. Get a Gemini API key

Get one at: https://aistudio.google.com/app/apikey

### 3. Configure Claude Desktop

Edit your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add Mnemo to the `mcpServers` section:

```json
{
  "mcpServers": {
    "mnemo": {
      "command": "bun",
      "args": ["run", "/path/to/mnemo/packages/local/src/stdio.ts"],
      "env": {
        "GEMINI_API_KEY": "your-gemini-api-key"
      }
    }
  }
}
```

Replace `/path/to/mnemo` with the actual path to your Mnemo installation.

### 4. Restart Claude Desktop

After saving the config, restart Claude Desktop. You should see Mnemo's tools available.

## Available Tools

Once connected, Claude Desktop will have access to:

| Tool | Description |
|------|-------------|
| `context_load` | Load a codebase or document into Gemini's context cache |
| `context_query` | Query the cached context |
| `context_list` | List all active caches |
| `context_evict` | Remove a cache |
| `context_stats` | Get usage statistics |

## Usage Examples

In Claude Desktop, you can now say things like:

- "Load the repository at https://github.com/owner/repo as 'myproject'"
- "Query myproject: What are the main components of this codebase?"
- "List all my cached contexts"
- "Evict the myproject cache"

## Debugging

Enable debug logging by adding to the env:

```json
{
  "env": {
    "GEMINI_API_KEY": "your-key",
    "MNEMO_DEBUG": "1"
  }
}
```

Debug output goes to stderr, which Claude Desktop captures in logs.

## Data Location

Mnemo stores its SQLite database at `~/.mnemo/mnemo.db` by default. Override with:

```json
{
  "env": {
    "MNEMO_DIR": "/custom/path"
  }
}
```
