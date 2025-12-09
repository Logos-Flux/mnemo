import {
  GeminiClient,
  RepoLoader,
  SourceLoader,
  UrlAdapter,
  type CacheStorage,
  type UsageLogger,
  MnemoError,
} from '@mnemo/core';
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type MCPToolCallResponse,
  JsonRpcRequestSchema,
  MCPMethods,
  ServerInfo,
  ErrorCodes,
} from './protocol';
import { toolDefinitions } from './tools/schemas';
import {
  handleContextLoad,
  handleContextQuery,
  handleContextList,
  handleContextEvict,
  handleContextStats,
  handleContextRefresh,
  type ToolHandlerDeps,
} from './tools/handlers';

export interface MnemoMCPServerConfig {
  geminiClient: GeminiClient;
  storage: CacheStorage;
  repoLoader?: RepoLoader;
  sourceLoader?: SourceLoader;
  urlAdapter?: UrlAdapter;
  usageLogger?: UsageLogger;
}

/**
 * MCP Server for Mnemo
 * Handles JSON-RPC 2.0 requests according to MCP specification
 */
export class MnemoMCPServer {
  private deps: ToolHandlerDeps;

  constructor(config: MnemoMCPServerConfig) {
    this.deps = {
      geminiClient: config.geminiClient,
      storage: config.storage,
      repoLoader: config.repoLoader ?? new RepoLoader(),
      sourceLoader: config.sourceLoader ?? new SourceLoader(),
      urlAdapter: config.urlAdapter ?? new UrlAdapter(),
      usageLogger: config.usageLogger,
    };
  }

  /**
   * Handle an incoming MCP request
   */
  async handleRequest(rawRequest: unknown): Promise<JsonRpcResponse> {
    // Parse and validate request
    const parseResult = JsonRpcRequestSchema.safeParse(rawRequest);
    if (!parseResult.success) {
      return this.errorResponse(null, ErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC request');
    }

    const request = parseResult.data;

    try {
      const result = await this.routeMethod(request);
      return this.successResponse(request.id, result);
    } catch (error) {
      return this.handleError(request.id, error);
    }
  }

  /**
   * Route request to appropriate handler
   */
  private async routeMethod(request: JsonRpcRequest): Promise<unknown> {
    switch (request.method) {
      case MCPMethods.INITIALIZE:
        return this.handleInitialize();

      case MCPMethods.TOOLS_LIST:
        return this.handleToolsList();

      case MCPMethods.TOOLS_CALL:
        return this.handleToolsCall(request.params);

      default:
        throw new MethodNotFoundError(request.method);
    }
  }

  /**
   * Handle initialize request
   */
  private handleInitialize(): {
    protocolVersion: string;
    serverInfo: { name: string; version: string };
    capabilities: { tools: Record<string, never> };
  } {
    return {
      protocolVersion: ServerInfo.protocolVersion,
      serverInfo: {
        name: ServerInfo.name,
        version: ServerInfo.version,
      },
      capabilities: ServerInfo.capabilities,
    };
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(): { tools: typeof toolDefinitions } {
    return { tools: toolDefinitions };
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(
    params: Record<string, unknown> | undefined
  ): Promise<MCPToolCallResponse> {
    if (!params?.name || typeof params.name !== 'string') {
      throw new InvalidParamsError('Tool name is required');
    }

    const toolName = params.name;
    const args = (params.arguments as Record<string, unknown>) ?? {};

    try {
      let result: unknown;

      switch (toolName) {
        case 'context_load':
          result = await handleContextLoad(this.deps, args);
          break;
        case 'context_query':
          result = await handleContextQuery(this.deps, args);
          break;
        case 'context_list':
          result = await handleContextList(this.deps);
          break;
        case 'context_evict':
          result = await handleContextEvict(this.deps, args);
          break;
        case 'context_stats':
          result = await handleContextStats(this.deps, args);
          break;
        case 'context_refresh':
          result = await handleContextRefresh(this.deps, args);
          break;
        default:
          throw new MethodNotFoundError(`Unknown tool: ${toolName}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // Return error as tool result (not JSON-RPC error)
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Get tool definitions (for direct access)
   */
  getToolDefinitions(): typeof toolDefinitions {
    return toolDefinitions;
  }

  /**
   * Create success response
   */
  private successResponse(
    id: string | number | null | undefined,
    result: unknown
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result,
    };
  }

  /**
   * Create error response
   */
  private errorResponse(
    id: string | number | null | undefined,
    code: number,
    message: string,
    data?: unknown
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, data },
    };
  }

  /**
   * Handle errors and convert to JSON-RPC format
   */
  private handleError(
    id: string | number | null | undefined,
    error: unknown
  ): JsonRpcResponse {
    if (error instanceof MethodNotFoundError) {
      return this.errorResponse(id, ErrorCodes.METHOD_NOT_FOUND, error.message);
    }
    if (error instanceof InvalidParamsError) {
      return this.errorResponse(id, ErrorCodes.INVALID_PARAMS, error.message);
    }
    if (error instanceof MnemoError) {
      return this.errorResponse(id, ErrorCodes.INTERNAL_ERROR, error.message, {
        code: error.code,
        details: error.details,
      });
    }
    if (error instanceof Error) {
      return this.errorResponse(id, ErrorCodes.INTERNAL_ERROR, error.message);
    }
    return this.errorResponse(id, ErrorCodes.INTERNAL_ERROR, 'Unknown error');
  }
}

// Error classes
class MethodNotFoundError extends Error {
  constructor(method: string) {
    super(`Method not found: ${method}`);
    this.name = 'MethodNotFoundError';
  }
}

class InvalidParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidParamsError';
  }
}
