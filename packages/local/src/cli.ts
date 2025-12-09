#!/usr/bin/env bun

/**
 * Mnemo CLI
 * Command-line interface for Mnemo context management
 */

const MNEMO_URL = process.env.MNEMO_URL ?? 'http://localhost:8080';

async function callTool(toolName: string, args: Record<string, unknown> = {}) {
  const response = await fetch(`${MNEMO_URL}/tools/${toolName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error ?? 'Request failed');
  }

  return response.json();
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'serve':
        // Start the server (import and run)
        await import('./index');
        break;

      case 'stdio':
      case '--stdio':
        // Start MCP stdio transport for Claude Desktop
        await import('./stdio');
        break;

      case 'load': {
        const source = args[1];
        const alias = args[2];
        if (!source || !alias) {
          console.error('Usage: mnemo load <path> <alias>');
          process.exit(1);
        }
        console.log(`Loading ${source} as "${alias}"...`);
        const result = await callTool('context_load', { source, alias });
        console.log('✓ Loaded successfully');
        console.log(`  Tokens: ${result.content?.[0]?.text ? JSON.parse(result.content[0].text).cache?.tokenCount : 'unknown'}`);
        break;
      }

      case 'query': {
        const alias = args[1];
        const query = args.slice(2).join(' ');
        if (!alias || !query) {
          console.error('Usage: mnemo query <alias> <question>');
          process.exit(1);
        }
        console.log(`Querying "${alias}"...`);
        const result = await callTool('context_query', { alias, query });
        const parsed = result.content?.[0]?.text ? JSON.parse(result.content[0].text) : result;
        console.log('\n' + (parsed.response ?? JSON.stringify(parsed, null, 2)));
        break;
      }

      case 'list': {
        const result = await callTool('context_list', {});
        const parsed = result.content?.[0]?.text ? JSON.parse(result.content[0].text) : result;
        if (!parsed.caches?.length) {
          console.log('No active caches');
        } else {
          console.log('\nActive caches:');
          console.log('─'.repeat(60));
          for (const cache of parsed.caches) {
            const expires = new Date(cache.expiresAt);
            const remaining = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 60000));
            console.log(`  ${cache.alias}`);
            console.log(`    Source: ${cache.source}`);
            console.log(`    Tokens: ${cache.tokenCount.toLocaleString()}`);
            console.log(`    Expires: ${remaining} minutes`);
            console.log('');
          }
        }
        break;
      }

      case 'evict': {
        const alias = args[1];
        if (!alias) {
          console.error('Usage: mnemo evict <alias>');
          process.exit(1);
        }
        await callTool('context_evict', { alias });
        console.log(`✓ Evicted "${alias}"`);
        break;
      }

      case 'stats': {
        const alias = args[1];
        const result = await callTool('context_stats', alias ? { alias } : {});
        const parsed = result.content?.[0]?.text ? JSON.parse(result.content[0].text) : result;
        console.log('\nStatistics:');
        console.log(`  Total caches: ${parsed.totalCaches}`);
        console.log(`  Total tokens: ${parsed.totalTokens.toLocaleString()}`);
        break;
      }

      case 'health': {
        const response = await fetch(`${MNEMO_URL}/health`);
        const data = await response.json();
        console.log('Server status:', data.status);
        break;
      }

      case 'help':
      case '--help':
      case '-h':
      default:
        console.log(`
Mnemo CLI - Extended memory for AI assistants

Usage:
  mnemo <command> [arguments]

Commands:
  serve                     Start the Mnemo HTTP server
  stdio                     Start MCP stdio transport (for Claude Desktop)
  load <path> <alias>       Load a directory/file into cache
  query <alias> <question>  Query a cached context
  list                      List all active caches
  evict <alias>             Remove a cache
  stats [alias]             Show usage statistics
  health                    Check server health
  help                      Show this help message

Environment:
  GEMINI_API_KEY           Gemini API key (required)
  MNEMO_URL                Server URL (default: http://localhost:8080)
  MNEMO_PORT               Server port (default: 8080)
  MNEMO_DIR                Data directory (default: ~/.mnemo)

Examples:
  mnemo serve
  mnemo load ./my-project my-proj
  mnemo query my-proj "What does this codebase do?"
  mnemo list
  mnemo evict my-proj
`);
        break;
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
