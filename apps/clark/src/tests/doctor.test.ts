import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import { WebSocketServer } from 'ws';

import { loadSettings } from '../config/settings.js';
import { runDoctor } from '../core/doctor.js';

describe('doctor', () => {
  it('reports pass when server and MCP provider are reachable', async () => {
    const wsServer = new WebSocketServer({ port: 0 });
    await once(wsServer, 'listening');
    const wsAddress = wsServer.address();
    if (!wsAddress || typeof wsAddress === 'string') {
      throw new Error('Expected ws address');
    }

    const mcpServer = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id: string; method: string };
      res.writeHead(200, { 'content-type': 'application/json' });
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
    });

    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const mcpAddress = mcpServer.address();
    if (!mcpAddress || typeof mcpAddress === 'string') {
      throw new Error('Expected mcp address');
    }

    const configPath = writeTempConfig({
      providers: {
        youbora: {
          kind: 'mcp-http',
          url: `http://127.0.0.1:${mcpAddress.port}`,
          enabled: true,
          timeoutMs: 3000,
        },
      },
      capabilities: [
        {
          name: 'youbora.session.fetch',
          description: 'Busca session no Youbora',
          provider: 'youbora',
          tool: 'get_session_details',
          requiresApproval: false,
        },
      ],
    });

    const settings = loadSettings({
      CLARK_SERVER_URL: `ws://127.0.0.1:${wsAddress.port}`,
      CLARK_CONFIG_PATH: configPath,
    });

    const report = await runDoctor(settings);

    expect(report.ok).toBe(true);
    expect(report.capabilities).toContain('youbora.session.fetch');
    expect(report.checks.some((check) => check.name === 'server.connectivity' && check.status === 'pass')).toBe(true);
    expect(report.checks.some((check) => check.name === 'mcp.youbora' && check.status === 'pass')).toBe(true);

    await new Promise<void>((resolve, reject) => {
      wsServer.close((error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      mcpServer.close((error) => (error ? reject(error) : resolve()));
    });
  });
});

function writeTempConfig(config: unknown): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clark-doctor-'));
  const configPath = path.join(tempDir, 'clark.config.json');
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  return configPath;
}
