import WebSocket from 'ws';
import pino from 'pino';

import { createCapabilityRegistry } from '../capabilities/index.js';
import type { ClarkSettings } from '../config/settings.js';
import { createProviderClient } from '../mcp/capability-provider.js';

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  details?: unknown;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  capabilities: string[];
}

export async function runDoctor(settings: ClarkSettings): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  checks.push({
    name: 'config.load',
    status: 'pass',
    details: {
      configPath: settings.configPath,
      clientId: settings.clientId,
      serverUrl: settings.serverUrl,
    },
  });

  checks.push(await checkServerConnectivity(settings.serverUrl));

  for (const server of settings.mcpHttpServers) {
    checks.push(await inspectMcpProvider(settings, server.name));
  }

  const bootstrap = await createCapabilityRegistry(settings, pino({ enabled: false }));

  checks.push({
    name: 'capabilities.bootstrap',
    status: bootstrap.registry.list().length > 0 ? 'pass' : 'warn',
    details: {
      capabilities: bootstrap.registry.list().map((item) => item.name),
      providers: bootstrap.providers,
    },
  });

  return {
    ok: checks.every((check) => check.status !== 'fail'),
    checks,
    capabilities: bootstrap.registry.list().map((item) => item.name),
  };
}

async function checkServerConnectivity(serverUrl: string): Promise<DoctorCheck> {
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(serverUrl);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Timed out while connecting to WebSocket server'));
      }, 3000);

      socket.once('open', () => {
        clearTimeout(timeout);
        socket.close();
        resolve();
      });

      socket.once('error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    return {
      name: 'server.connectivity',
      status: 'pass',
      details: { serverUrl },
    };
  } catch (error) {
    return {
      name: 'server.connectivity',
      status: 'fail',
      details: {
        serverUrl,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

async function inspectMcpProvider(settings: ClarkSettings, serverName: string): Promise<DoctorCheck> {
  const server = settings.mcpHttpServers.find((item) => item.name === serverName);
  if (!server) {
    return {
      name: `mcp.${serverName}`,
      status: 'fail',
      details: {
        serverName,
        message: 'Provider not found in settings',
      },
    };
  }

  const bindings = settings.mcpCapabilityBindings.filter((item) => item.serverName === serverName);
  const client = createProviderClient(settings, server);

  try {
    const tools = await client.listTools();
    const missingBindings = bindings
      .filter((binding) => !tools.some((tool) => tool.name === binding.toolName))
      .map((binding) => ({
        capabilityName: binding.capabilityName,
        toolName: binding.toolName,
      }));

    return {
      name: `mcp.${serverName}`,
      status: missingBindings.length > 0 ? 'warn' : 'pass',
      details: {
        serverName,
        url: server.baseUrl,
        toolCount: tools.length,
        bindings: bindings.map((binding) => ({
          capabilityName: binding.capabilityName,
          toolName: binding.toolName,
          found: !missingBindings.some((item) => item.toolName === binding.toolName),
        })),
      },
    };
  } catch (error) {
    return {
      name: `mcp.${serverName}`,
      status: 'fail',
      details: {
        serverName,
        url: server.baseUrl,
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}
