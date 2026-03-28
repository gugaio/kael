import { lookup } from 'node:dns/promises';
import { z } from 'zod';

import type { Capability } from '../core/capability.js';

interface NetworkCheckInput {
  host: string;
}

interface NetworkCheckOutput {
  host: string;
  address: string;
  family: number;
}

export function createNetworkCheckCapability(): Capability<NetworkCheckInput, NetworkCheckOutput> {
  return {
    descriptor: {
      name: 'network.check',
      description: 'Resolve DNS de um host para verificar conectividade basica.',
      requiresApproval: false,
    },
    inputSchema: z.object({
      host: z.string().min(1).default('localhost'),
    }),
    async execute(input) {
      const result = await lookup(input.host);
      return {
        host: input.host,
        address: result.address,
        family: result.family,
      };
    },
  };
}
