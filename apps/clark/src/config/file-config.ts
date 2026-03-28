import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const providerSchema = z.object({
  kind: z.enum(['mcp-http', 'mcp-http-bridge']),
  url: z.string().url(),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(5000),
  headers: z.record(z.string(), z.string()).optional(),
});

const capabilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  provider: z.string().min(1),
  tool: z.string().min(1),
  requiresApproval: z.boolean().default(false),
});

const httpProfileSchema = z.object({
  baseUrl: z.string().url(),
  allowedMethods: z.array(z.enum(['GET'])).default(['GET']),
  timeoutMs: z.number().int().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
  defaultHeaders: z.record(z.string(), z.string()).default({}),
});

const clarkFileConfigSchema = z.object({
  providers: z.record(z.string(), providerSchema).default({}),
  capabilities: z.array(capabilitySchema).default([]),
  httpProfiles: z.record(z.string(), httpProfileSchema).default({}),
});

export type ClarkFileConfig = z.infer<typeof clarkFileConfigSchema>;

export function loadClarkFileConfig(configPathFromEnv?: string): { path: string; config: ClarkFileConfig } {
  const resolvedPath = resolveClarkConfigPath(configPathFromEnv);
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  return {
    path: resolvedPath,
    config: clarkFileConfigSchema.parse(parsed),
  };
}

function resolveClarkConfigPath(configPathFromEnv?: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultProjectPath = path.resolve(moduleDir, '../../clark.config.json');

  if (configPathFromEnv) {
    const cwdResolved = path.resolve(process.cwd(), configPathFromEnv);
    if (fs.existsSync(cwdResolved)) {
      return cwdResolved;
    }

    if (path.isAbsolute(configPathFromEnv)) {
      return configPathFromEnv;
    }

    const projectResolved = path.resolve(moduleDir, '../../', configPathFromEnv);
    return projectResolved;
  }

  return defaultProjectPath;
}
