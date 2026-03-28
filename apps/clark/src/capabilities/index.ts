import type { Logger } from 'pino';

import type { ClarkSettings } from '../config/settings.js';
import { CapabilityRegistry } from '../core/capability-registry.js';
import { createRegistryWithMcpCapabilities } from '../mcp/capability-provider.js';
import type { McpProviderInfo } from '../mcp/types.js';
import { createInternalHttpFetchCapability } from './internal-http-fetch.js';
import { createInternalHttpProfileRequestCapability } from './internal-http-profile-request.js';
import { createNetworkCheckCapability } from './network-check.js';
import { createSystemInfoCapability } from './system-info.js';

export interface CapabilityBootstrapResult {
  registry: CapabilityRegistry;
  providers: McpProviderInfo[];
}

export async function createCapabilityRegistry(
  settings: ClarkSettings,
  logger: Logger,
): Promise<CapabilityBootstrapResult> {
  const registry = new CapabilityRegistry();

  registry.register(createSystemInfoCapability());
  registry.register(createNetworkCheckCapability());
  registry.register(createInternalHttpFetchCapability({
    allowlist: settings.httpAllowlist,
    timeoutMs: settings.httpTimeoutMs,
    maxBytes: settings.httpMaxBytes,
  }));
  registry.register(createInternalHttpProfileRequestCapability({
    profiles: settings.httpProfiles,
  }));

  return createRegistryWithMcpCapabilities(registry, settings, logger);
}
