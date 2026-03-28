import { createLogger } from '../../services/logger.js';
import { loadSettings } from '../../config/settings.js';
import { createCapabilityRegistry } from '../../capabilities/index.js';

export async function runCapabilitiesCommand(): Promise<void> {
  const settings = loadSettings();
  const logger = createLogger(settings.logLevel);
  const registry = await createCapabilityRegistry(settings, logger);

  console.log(JSON.stringify({
    capabilities: registry.registry.list(),
    providers: registry.providers,
  }, null, 2));
}
