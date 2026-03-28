import { parseEnv } from './env.js';
import { loadClarkFileConfig } from './file-config.js';

export interface McpHttpServerSettings {
  name: string;
  kind: 'mcp-http' | 'mcp-http-bridge';
  baseUrl: string;
  timeoutMs: number;
  headers?: Record<string, string>;
}

export interface McpCapabilityBindingSettings {
  capabilityName: string;
  description: string;
  serverName: string;
  toolName: string;
  requiresApproval: boolean;
}

export interface ClarkSettings {
  configPath: string;
  serverUrl: string;
  clientId: string;
  clientName: string;
  heartbeatIntervalMs: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  taskTimeoutMs: number;
  httpAllowlist: string[];
  httpTimeoutMs: number;
  httpMaxBytes: number;
  mcpBridgeBinary: string;
  mcpBridgeConfigPath?: string;
  mcpBridgeMaxOutputChars: number;
  mcpHttpServers: McpHttpServerSettings[];
  mcpCapabilityBindings: McpCapabilityBindingSettings[];
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

export function loadSettings(source: NodeJS.ProcessEnv = process.env): ClarkSettings {
  const env = parseEnv(source);
  const fileConfig = loadClarkFileConfig(env.CLARK_CONFIG_PATH);

  return {
    configPath: fileConfig.path,
    serverUrl: env.CLARK_SERVER_URL,
    clientId: env.CLARK_CLIENT_ID,
    clientName: env.CLARK_CLIENT_NAME,
    heartbeatIntervalMs: env.CLARK_HEARTBEAT_INTERVAL_MS,
    reconnectBaseDelayMs: env.CLARK_RECONNECT_BASE_DELAY_MS,
    reconnectMaxDelayMs: env.CLARK_RECONNECT_MAX_DELAY_MS,
    taskTimeoutMs: env.CLARK_TASK_TIMEOUT_MS,
    httpAllowlist: env.CLARK_HTTP_ALLOWLIST.split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
    httpTimeoutMs: env.CLARK_HTTP_TIMEOUT_MS,
    httpMaxBytes: env.CLARK_HTTP_MAX_BYTES,
    mcpBridgeBinary: env.CLARK_MCP_BRIDGE_BINARY,
    mcpBridgeConfigPath: env.CLARK_MCP_BRIDGE_CONFIG_PATH?.trim() || undefined,
    mcpBridgeMaxOutputChars: env.CLARK_MCP_BRIDGE_MAX_OUTPUT_CHARS,
    mcpHttpServers: Object.entries(fileConfig.config.providers)
      .filter(([, provider]) => provider.enabled)
      .map(([name, provider]) => ({
        name,
        kind: provider.kind,
        baseUrl: provider.url,
        timeoutMs: provider.timeoutMs,
        headers: provider.headers,
      })),
    mcpCapabilityBindings: fileConfig.config.capabilities
      .filter((capability) => {
        const provider = fileConfig.config.providers[capability.provider];
        return provider?.enabled ?? false;
      })
      .map((capability) => ({
        capabilityName: capability.name,
        description: capability.description,
        serverName: capability.provider,
        toolName: capability.tool,
        requiresApproval: capability.requiresApproval,
      })),
    logLevel: env.CLARK_LOG_LEVEL,
  };
}
