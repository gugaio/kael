import { z } from 'zod';

import type { Capability } from '../core/capability.js';
import { ClarkError } from '../utils/errors.js';

export interface InternalHttpFetchOptions {
  allowlist: string[];
  timeoutMs: number;
  maxBytes: number;
}

const inputSchema = z.object({
  url: z.string().url(),
  method: z.literal('GET').default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
});

type InternalHttpFetchInput = z.infer<typeof inputSchema>;

interface InternalHttpFetchOutput {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function createInternalHttpFetchCapability(
  options: InternalHttpFetchOptions,
): Capability<InternalHttpFetchInput, InternalHttpFetchOutput> {
  return {
    descriptor: {
      name: 'internal.http.fetch',
      description: 'Faz request HTTP GET para hosts explicitamente permitidos.',
      requiresApproval: false,
    },
    inputSchema,
    async execute(input) {
      const targetUrl = new URL(input.url);
      const hostname = targetUrl.hostname.toLowerCase();
      const hostAllowed = options.allowlist.includes(hostname);

      if (!hostAllowed) {
        throw new ClarkError('host_not_allowed', `Host not allowed: ${hostname}`);
      }

      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: input.headers,
        signal: AbortSignal.timeout(options.timeoutMs),
        redirect: 'error',
      });

      if (!response.ok) {
        throw new ClarkError('http_error', `HTTP request failed with status ${response.status}`, {
          status: response.status,
        });
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return {
          url: targetUrl.toString(),
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: '',
        };
      }

      let total = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        total += value.byteLength;
        if (total > options.maxBytes) {
          throw new ClarkError('response_too_large', `Response exceeded ${options.maxBytes} bytes`);
        }

        chunks.push(value);
      }

      const body = Buffer.concat(chunks).toString('utf8');

      return {
        url: targetUrl.toString(),
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      };
    },
  };
}
