import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseEnv } from '../config/env.js';
import { loadSettings } from '../config/settings.js';

describe('config', () => {
  it('parses required settings', () => {
    const env = parseEnv({
      CLARK_SERVER_URL: 'ws://localhost:8080/ws',
    });

    expect(env.CLARK_CLIENT_ID).toBe('clark-local');
  });

  it('normalizes allowlist', () => {
    const configPath = writeTempConfig({
      providers: {},
      capabilities: [],
    });

    const settings = loadSettings({
      CLARK_SERVER_URL: 'ws://localhost:8080/ws',
      CLARK_HTTP_ALLOWLIST: ' localhost, INTERNAL.example.com ',
      CLARK_CONFIG_PATH: configPath,
    });

    expect(settings.httpAllowlist).toEqual(['localhost', 'internal.example.com']);
  });

  it('parses MCP HTTP servers and bindings from clark.config.json', () => {
    const configPath = writeTempConfig({
      providers: {
        'corp-observability': {
          kind: 'mcp-http',
          url: 'http://127.0.0.1:8090/mcp',
          enabled: true,
          timeoutMs: 4000,
        },
      },
      capabilities: [
        {
          name: 'corp.session.fetch',
          description: 'Busca sessions via MCP',
          provider: 'corp-observability',
          tool: 'get_session_details',
          requiresApproval: false,
        },
      ],
    });

    const settings = loadSettings({
      CLARK_SERVER_URL: 'ws://localhost:8080/ws',
      CLARK_CONFIG_PATH: configPath,
    });

    expect(settings.mcpHttpServers).toHaveLength(1);
    expect(settings.mcpHttpServers[0]?.name).toBe('corp-observability');
    expect(settings.mcpCapabilityBindings[0]?.capabilityName).toBe('corp.session.fetch');
  });
});

function writeTempConfig(config: unknown): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clark-config-'));
  const configPath = path.join(tempDir, 'clark.config.json');
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  return configPath;
}
