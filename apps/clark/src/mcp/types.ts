export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpProviderInfo {
  name: string;
  kind: 'mcp-http' | 'mcp-http-bridge';
  status: 'available' | 'unreachable';
  capabilities: string[];
}
