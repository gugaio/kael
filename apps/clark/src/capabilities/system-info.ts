import os from 'node:os';
import { z } from 'zod';

import type { Capability } from '../core/capability.js';

export function createSystemInfoCapability(): Capability {
  return {
    descriptor: {
      name: 'system.info',
      description: 'Retorna contexto basico da maquina local.',
      requiresApproval: false,
    },
    inputSchema: z.object({}).passthrough(),
    async execute() {
      return {
        hostname: os.hostname(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        uptimeSeconds: Math.round(os.uptime()),
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytes: os.freemem(),
      };
    },
  };
}
