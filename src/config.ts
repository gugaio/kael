import path from "node:path";
import { expandHome, loadGlobalConfig } from "./global-config.js";

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

export async function loadConfig(cwd = process.cwd()): Promise<KaelConfig> {
  const globalConfig = await loadGlobalConfig();

  const defaultPort = globalConfig?.defaults.port ?? 3210;
  const envPort = Number(process.env.KAEL_PORT ?? String(defaultPort));
  const port = Number.isFinite(envPort) && envPort > 0 ? envPort : defaultPort;

  const host =
    process.env.KAEL_HOST?.trim() || globalConfig?.defaults.host || "127.0.0.1";

  const globalDataDir = globalConfig?.defaults.dataDir
    ? expandHome(globalConfig.defaults.dataDir)
    : undefined;
  const dataDir =
    process.env.KAEL_DATA_DIR?.trim() || globalDataDir || path.join(cwd, ".kael-data");

  const engineMode = parseEngineMode(
    process.env.KAEL_ENGINE_MODE ?? globalConfig?.defaults.engineMode,
  );

  const defaultTimeout = globalConfig?.defaults.pi.timeoutMs ?? 45000;
  const timeoutRaw = Number(process.env.KAEL_PI_TIMEOUT_MS ?? String(defaultTimeout));
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : defaultTimeout;

  const apiKey = process.env.KAEL_PI_API_KEY?.trim();
  const pi: PiEngineConfig = {
    enabled: Boolean(apiKey),
    apiUrl:
      process.env.KAEL_PI_API_URL?.trim() ||
      globalConfig?.defaults.pi.apiUrl ||
      "https://api.openai.com/v1/chat/completions",
    apiKey,
    model: process.env.KAEL_PI_MODEL?.trim() || globalConfig?.defaults.pi.model || "gpt-4o-mini",
    timeoutMs,
  };

  return { port, host, dataDir, engineMode, pi };
}
