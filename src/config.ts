import path from "node:path";

export type EngineMode = "simple" | "pi" | "hybrid";

export type PiEngineConfig = {
  enabled: boolean;
  apiUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
};

export type KaelConfig = {
  port: number;
  host: string;
  dataDir: string;
  engineMode: EngineMode;
  pi: PiEngineConfig;
};

function parseEngineMode(raw: string | undefined): EngineMode {
  const value = raw?.trim().toLowerCase();
  if (value === "pi" || value === "hybrid") {
    return value;
  }
  return "simple";
}

export function loadConfig(cwd = process.cwd()): KaelConfig {
  const envPort = Number(process.env.KAEL_PORT ?? "3210");
  const port = Number.isFinite(envPort) && envPort > 0 ? envPort : 3210;

  const host = process.env.KAEL_HOST?.trim() || "127.0.0.1";
  const dataDir = process.env.KAEL_DATA_DIR?.trim() || path.join(cwd, ".kael-data");
  const engineMode = parseEngineMode(process.env.KAEL_ENGINE_MODE);

  const timeoutRaw = Number(process.env.KAEL_PI_TIMEOUT_MS ?? "45000");
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 45000;
  const apiKey = process.env.KAEL_PI_API_KEY?.trim();

  const pi: PiEngineConfig = {
    enabled: Boolean(apiKey),
    apiUrl: process.env.KAEL_PI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions",
    apiKey,
    model: process.env.KAEL_PI_MODEL?.trim() || "gpt-4o-mini",
    timeoutMs,
  };

  return { port, host, dataDir, engineMode, pi };
}
