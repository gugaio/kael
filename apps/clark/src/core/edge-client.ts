import type { Logger } from 'pino';

import type { ClarkSettings } from '../config/settings.js';
import { createCapabilityRegistry } from '../capabilities/index.js';
import { ConnectionManager } from './connection-manager.js';
import { TaskExecutor } from './task-executor.js';
import { buildClientInfo } from '../services/machine-context.js';
import packageJson from '../../package.json' with { type: 'json' };

export class EdgeClient {
  private readonly registry;
  private readonly connectionManager;

  private constructor(
    private readonly settings: ClarkSettings,
    private readonly logger: Logger,
    registry: Awaited<ReturnType<typeof createCapabilityRegistry>>['registry'],
    providers: Awaited<ReturnType<typeof createCapabilityRegistry>>['providers'],
  ) {
    this.registry = registry;
    const executor = new TaskExecutor(this.registry, logger, settings.taskTimeoutMs);
    const clientInfo = buildClientInfo({
      clientId: settings.clientId,
      clientName: settings.clientName,
      version: packageJson.version,
      capabilities: this.registry.list(),
      providers,
    });

    this.connectionManager = new ConnectionManager({
      serverUrl: settings.serverUrl,
      clientId: settings.clientId,
      clientInfo,
      heartbeatIntervalMs: settings.heartbeatIntervalMs,
      reconnectBaseDelayMs: settings.reconnectBaseDelayMs,
      reconnectMaxDelayMs: settings.reconnectMaxDelayMs,
    }, executor, logger);
  }

  static async create(settings: ClarkSettings, logger: Logger): Promise<EdgeClient> {
    const bootstrap = await createCapabilityRegistry(settings, logger);
    return new EdgeClient(settings, logger, bootstrap.registry, bootstrap.providers);
  }

  listCapabilities() {
    return this.registry.list();
  }

  async run(): Promise<void> {
    this.logger.info({
      event: 'client.starting',
      serverUrl: this.settings.serverUrl,
      clientId: this.settings.clientId,
      capabilities: this.registry.list().map((item) => item.name),
    }, 'Clark daemon starting');

    await this.connectionManager.start();
  }

  async stop(): Promise<void> {
    await this.connectionManager.stop();
  }
}
