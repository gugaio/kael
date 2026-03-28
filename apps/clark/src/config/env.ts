import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const envSchema = z.object({
  CLARK_SERVER_URL: z.string().url(),
  CLARK_CLIENT_ID: z.string().min(1).default('clark-local'),
  CLARK_CLIENT_NAME: z.string().min(1).default('Clark Local'),
  CLARK_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  CLARK_RECONNECT_BASE_DELAY_MS: z.coerce.number().int().positive().default(1000),
  CLARK_RECONNECT_MAX_DELAY_MS: z.coerce.number().int().positive().default(30000),
  CLARK_TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  CLARK_HTTP_ALLOWLIST: z.string().default('localhost,127.0.0.1'),
  CLARK_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  CLARK_HTTP_MAX_BYTES: z.coerce.number().int().positive().default(65536),
  CLARK_CONFIG_PATH: z.string().default('./clark.config.json'),
  CLARK_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type ClarkEnv = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): ClarkEnv {
  return envSchema.parse(source);
}
