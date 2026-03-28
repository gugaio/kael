import os from 'node:os';

import { loadSettings } from '../../config/settings.js';

export function runStatusCommand(): void {
  const settings = loadSettings();

  console.log(JSON.stringify({
    configPath: settings.configPath,
    clientId: settings.clientId,
    clientName: settings.clientName,
    serverUrl: settings.serverUrl,
    hostname: os.hostname(),
    heartbeatIntervalMs: settings.heartbeatIntervalMs,
    httpAllowlist: settings.httpAllowlist,
    mcpHttpServers: settings.mcpHttpServers.map((item) => ({
      name: item.name,
      baseUrl: item.baseUrl,
    })),
    mcpCapabilityBindings: settings.mcpCapabilityBindings,
  }, null, 2));
}
