import type { Logger } from 'pino';
import { z } from 'zod';

import type {
  ClarkSettings,
  McpCapabilityBindingSettings,
  McpHttpServerSettings,
} from '../config/settings.js';
import type { Capability } from '../core/capability.js';
import { CapabilityRegistry } from '../core/capability-registry.js';
import { McpBridgeHttpClient } from './bridge-http-client.js';
import { McpHttpClient } from './http-client.js';
import type { McpProviderInfo, McpToolDescriptor } from './types.js';

interface DiscoveryResult {
  registry: CapabilityRegistry;
  providers: McpProviderInfo[];
}

export async function createRegistryWithMcpCapabilities(
  baseRegistry: CapabilityRegistry,
  settings: ClarkSettings,
  logger: Logger,
): Promise<DiscoveryResult> {
  const providers: McpProviderInfo[] = [];

  for (const server of settings.mcpHttpServers) {
    const bindings = settings.mcpCapabilityBindings.filter((item) => item.serverName === server.name);

    if (bindings.length === 0) {
      continue;
    }

    const provider = await discoverProvider(baseRegistry, settings, server, bindings, logger);
    providers.push(provider);
  }

  return {
    registry: baseRegistry,
    providers,
  };
}

async function discoverProvider(
  registry: CapabilityRegistry,
  settings: ClarkSettings,
  server: McpHttpServerSettings,
  bindings: McpCapabilityBindingSettings[],
  logger: Logger,
): Promise<McpProviderInfo> {
  const client = createProviderClient(settings, server);

  try {
    const tools = await client.listTools();
    const registeredCapabilities: string[] = [];

    for (const binding of bindings) {
      const tool = tools.find((item) => item.name === binding.toolName);
      if (!tool) {
        logger.warn({
          event: 'mcp.binding.missing_tool',
          serverName: server.name,
          toolName: binding.toolName,
          capabilityName: binding.capabilityName,
        }, 'Configured MCP binding tool was not found on provider');
        continue;
      }

      registry.register(createMcpBackedCapability(client, binding, tool));
      registeredCapabilities.push(binding.capabilityName);
    }

    return {
      name: server.name,
      kind: server.kind,
      status: 'available',
      capabilities: registeredCapabilities,
    };
  } catch (error) {
    const fallbackCapabilities: string[] = [];
    for (const binding of bindings) {
      registry.register(createMcpBackedCapability(client, binding));
      fallbackCapabilities.push(binding.capabilityName);
    }

    logger.warn({
      event: 'mcp.provider.unreachable',
      serverName: server.name,
      fallbackCapabilities,
      error,
    }, 'MCP HTTP provider was unreachable during startup; configured bindings were registered without discovery');

    return {
      name: server.name,
      kind: server.kind,
      status: 'unreachable',
      capabilities: [],
    };
  }
}

function createMcpBackedCapability(
  client: Pick<McpHttpClient, 'callTool'> | Pick<McpBridgeHttpClient, 'callTool'>,
  binding: McpCapabilityBindingSettings,
  tool?: McpToolDescriptor,
): Capability<Record<string, unknown>, unknown> {
  return {
    descriptor: {
      name: binding.capabilityName,
      description: binding.description || tool?.description || `Calls MCP tool ${binding.toolName}`,
      requiresApproval: binding.requiresApproval,
    },
    inputSchema: z.object({}).passthrough(),
    async execute(input) {
      return client.callTool(binding.toolName, input);
    },
  };
}

export function createProviderClient(
  settings: Pick<ClarkSettings, 'mcpBridgeBinary' | 'mcpBridgeConfigPath' | 'mcpBridgeMaxOutputChars'>,
  server: McpHttpServerSettings,
): Pick<McpHttpClient, 'listTools' | 'callTool'> | Pick<McpBridgeHttpClient, 'listTools' | 'callTool'> {
  if (server.kind === 'mcp-http-bridge') {
    return new McpBridgeHttpClient(server, settings);
  }

  return new McpHttpClient(server);
}
