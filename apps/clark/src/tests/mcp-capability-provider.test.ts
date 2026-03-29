import http from 'node:http';

import pino from 'pino';

import { CapabilityRegistry } from '../core/capability-registry.js';
import { createRegistryWithMcpCapabilities } from '../mcp/capability-provider.js';
import type { ClarkSettings } from '../config/settings.js';

describe('mcp capability provider', () => {
  it('registers configured MCP-backed capabilities when the provider is reachable', async () => {
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id: string; method: string };
      res.writeHead(200, { 'content-type': 'application/json' });

      if (body.method === 'tools/list') {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'get_session_details',
                description: 'Fetch session details',
              },
            ],
          },
        }));
        return;
      }

      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          sessionId: 'abc123',
        },
      }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected address info');
    }

    const settings: ClarkSettings = {
      configPath: '/tmp/clark.config.json',
      serverUrl: 'ws://localhost:8080/ws',
      clientId: 'test',
      clientName: 'Test',
      heartbeatIntervalMs: 1000,
      reconnectBaseDelayMs: 1000,
      reconnectMaxDelayMs: 5000,
      taskTimeoutMs: 5000,
      httpAllowlist: ['localhost'],
      httpTimeoutMs: 3000,
      httpMaxBytes: 4096,
      mcpBridgeBinary: 'mcporter',
      mcpBridgeConfigPath: undefined,
      mcpBridgeMaxOutputChars: 120000,
      httpProfiles: [],
      mcpHttpServers: [
        {
          name: 'corp-observability',
          kind: 'mcp-http',
          baseUrl: `http://127.0.0.1:${address.port}`,
          timeoutMs: 3000,
        },
      ],
      mcpCapabilityBindings: [
        {
          capabilityName: 'corp.session.fetch',
          description: 'Busca session via MCP',
          serverName: 'corp-observability',
          toolName: 'get_session_details',
          requiresApproval: false,
        },
      ],
      logLevel: 'error',
    };

    const result = await createRegistryWithMcpCapabilities(
      new CapabilityRegistry(),
      settings,
      pino({ enabled: false }),
    );

    expect(result.providers).toEqual([
      {
        name: 'corp-observability',
        kind: 'mcp-http',
        status: 'available',
        capabilities: ['corp.session.fetch'],
      },
    ]);
    expect(result.registry.get('corp.session.fetch')).toBeDefined();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('registers configured bindings even when provider discovery fails', async () => {
    const settings: ClarkSettings = {
      configPath: '/tmp/clark.config.json',
      serverUrl: 'ws://localhost:8080/ws',
      clientId: 'test',
      clientName: 'Test',
      heartbeatIntervalMs: 1000,
      reconnectBaseDelayMs: 1000,
      reconnectMaxDelayMs: 5000,
      taskTimeoutMs: 5000,
      httpAllowlist: ['localhost'],
      httpTimeoutMs: 3000,
      httpMaxBytes: 4096,
      mcpBridgeBinary: 'mcporter',
      mcpBridgeConfigPath: undefined,
      mcpBridgeMaxOutputChars: 120000,
      httpProfiles: [],
      mcpHttpServers: [
        {
          name: 'youbora',
          kind: 'mcp-http-bridge',
          baseUrl: 'https://youbora.example.com/mcp',
          timeoutMs: 3000,
        },
      ],
      mcpCapabilityBindings: [
        {
          capabilityName: 'youbora.metrics.get',
          description: 'Consulta metricas no Youbora',
          serverName: 'youbora',
          toolName: 'get_metrics',
          requiresApproval: false,
        },
      ],
      logLevel: 'error',
    };

    const result = await createRegistryWithMcpCapabilities(
      new CapabilityRegistry(),
      settings,
      pino({ enabled: false }),
    );

    expect(result.providers).toEqual([
      {
        name: 'youbora',
        kind: 'mcp-http-bridge',
        status: 'unreachable',
        capabilities: [],
      },
    ]);
    expect(result.registry.get('youbora.metrics.get')).toBeDefined();
  });
});
