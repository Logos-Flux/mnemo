import { z } from 'zod';

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes
export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ============================================================================
// MCP Protocol Types
// ============================================================================

export const MCPToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  }),
});

export type MCPToolDefinition = z.infer<typeof MCPToolDefinitionSchema>;

export interface MCPToolsListResponse {
  tools: MCPToolDefinition[];
}

export interface MCPToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolCallResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

// ============================================================================
// MCP Methods
// ============================================================================

export const MCPMethods = {
  // Lifecycle
  INITIALIZE: 'initialize',
  
  // Tools
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',
  
  // Resources (not implemented yet)
  RESOURCES_LIST: 'resources/list',
  RESOURCES_READ: 'resources/read',
  
  // Prompts (not implemented yet)
  PROMPTS_LIST: 'prompts/list',
  PROMPTS_GET: 'prompts/get',
} as const;

// ============================================================================
// Server Info
// ============================================================================

export const ServerInfo = {
  name: 'mnemo',
  version: '0.1.0',
  protocolVersion: '2024-11-05',
  capabilities: {
    tools: {},
  },
};
