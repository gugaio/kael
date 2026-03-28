import os from 'node:os';

import type { ClientInfo } from '../protocol/types.js';
import type { CapabilityDescriptor } from '../core/capability.js';
import type { McpProviderInfo } from '../mcp/types.js';

export function buildClientInfo(params: {
  clientId: string;
  clientName: string;
  version: string;
  capabilities: CapabilityDescriptor[];
  providers: McpProviderInfo[];
}): ClientInfo {
  return {
    clientId: params.clientId,
    clientName: params.clientName,
    hostname: os.hostname(),
    machineName: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    version: params.version,
    capabilities: params.capabilities,
    providers: params.providers,
    startedAt: new Date().toISOString(),
  };
}
