import { ClarkError } from '../utils/errors.js';
import type { McpHttpServerSettings } from '../config/settings.js';
import type { McpToolDescriptor } from './types.js';

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: string;
  result: T;
}

interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

const listToolsResponseSchema = {
  isListToolsResponse(input: unknown): input is { tools: McpToolDescriptor[] } {
    return typeof input === 'object' && input !== null && Array.isArray((input as { tools?: unknown }).tools);
  },
};

export class McpHttpClient {
  constructor(private readonly server: McpHttpServerSettings) {}

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = await this.sendRequest<unknown>('tools/list', {});

    if (!listToolsResponseSchema.isListToolsResponse(result)) {
      throw new ClarkError('invalid_mcp_response', `Invalid tools/list response from ${this.server.name}`);
    }

    return result.tools;
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    });
  }

  private async sendRequest<TResult>(method: string, params: Record<string, unknown>): Promise<TResult> {
    const response = await fetch(this.server.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.server.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `${this.server.name}:${method}:${Date.now()}`,
        method,
        params,
      }),
      signal: AbortSignal.timeout(this.server.timeoutMs),
    });

    if (!response.ok) {
      throw new ClarkError('mcp_http_error', `MCP HTTP request failed with status ${response.status}`, {
        serverName: this.server.name,
        status: response.status,
      });
    }

    const payload = await response.json() as JsonRpcResponse<TResult>;

    if ('error' in payload) {
      throw new ClarkError('mcp_remote_error', payload.error.message, {
        serverName: this.server.name,
        code: payload.error.code,
        data: payload.error.data,
      });
    }

    return payload.result;
  }
}
