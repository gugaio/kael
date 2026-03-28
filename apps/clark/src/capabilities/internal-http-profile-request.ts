import { z } from 'zod';

import type { HttpProfileSettings } from '../config/settings.js';
import type { Capability } from '../core/capability.js';
import { ClarkError } from '../utils/errors.js';

export interface InternalHttpProfileRequestOptions {
  profiles: HttpProfileSettings[];
}

const inputSchema = z.object({
  profile: z.string().min(1),
  path: z.string().min(1),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  method: z.literal('GET').default('GET'),
});

type InternalHttpProfileRequestInput = z.infer<typeof inputSchema>;

interface InternalHttpProfileRequestOutput {
  profile: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function createInternalHttpProfileRequestCapability(
  options: InternalHttpProfileRequestOptions,
): Capability<InternalHttpProfileRequestInput, InternalHttpProfileRequestOutput> {
  return {
    descriptor: {
      name: 'internal.http.profile_request',
      description: 'Faz request HTTP usando um profile local autorizado com headers/token injetados no Clark.',
      requiresApproval: false,
    },
    inputSchema,
    async execute(input) {
      const profile = options.profiles.find((item) => item.name === input.profile);
      if (!profile) {
        throw new ClarkError('unknown_http_profile', `HTTP profile not found: ${input.profile}`);
      }

      if (!profile.allowedMethods.includes(input.method)) {
        throw new ClarkError('http_method_not_allowed', `Method not allowed for profile ${input.profile}: ${input.method}`);
      }

      const targetUrl = new URL(input.path, ensureTrailingSlash(profile.baseUrl));
      for (const [key, value] of Object.entries(input.query ?? {})) {
        targetUrl.searchParams.set(key, String(value));
      }

      const response = await fetch(targetUrl, {
        method: input.method,
        headers: profile.defaultHeaders,
        signal: AbortSignal.timeout(profile.timeoutMs),
        redirect: 'error',
      });

      if (!response.ok) {
        throw new ClarkError('http_error', `HTTP request failed with status ${response.status}`, {
          status: response.status,
          profile: input.profile,
        });
      }

      const body = await readResponseBody(response, profile.maxBytes);

      return {
        profile: input.profile,
        url: targetUrl.toString(),
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      };
    },
  };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

async function readResponseBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }

  let total = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    total += value.byteLength;
    if (total > maxBytes) {
      throw new ClarkError('response_too_large', `Response exceeded ${maxBytes} bytes`);
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
}
