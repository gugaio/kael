import { loadSettings } from '../../config/settings.js';
import { EdgeClient } from '../../core/edge-client.js';
import { createLogger } from '../../services/logger.js';

export async function runDaemonCommand(): Promise<void> {
  const settings = loadSettings();
  const logger = createLogger(settings.logLevel);
  const client = await EdgeClient.create(settings, logger);

  const shutdown = async () => {
    logger.info({ event: 'client.stopping' }, 'Clark daemon stopping');
    await client.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await client.run();
}
