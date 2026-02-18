import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type KaelGlobalConfig = {
  version: number;
  defaults: {
    host: string;
    port: number;
    dataDir: string;
    engineMode: "simple" | "pi" | "hybrid";
    idempotency: {
      enabled: boolean;
      ttlMs: number;
    };
    pi: {
      provider: string;
      transport: "pi_sdk" | "local_process" | "openai_http";
      apiUrl: string;
      model: string;
      timeoutMs: number;
      local: {
        command: string;
        args: string[];
      };
      retry: {
        attempts: number;
        baseDelayMs: number;
        maxDelayMs: number;
        jitterMs: number;
      };
    };
  };
};

export type InitKaelHomeResult = {
  kaelHome: string;
  configPath: string;
  created: boolean;
};

export function resolveKaelHome(): string {
  const fromEnv = process.env.KAEL_HOME?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return path.join(os.homedir(), ".kael");
}

export function resolveKaelGlobalConfigPath(): string {
  return path.join(resolveKaelHome(), "config.json");
}

function withHomePlaceholder(inputPath: string): string {
  const home = os.homedir();
  if (inputPath.startsWith(home)) {
    return inputPath.replace(home, "~");
  }
  return inputPath;
}

export function expandHome(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function buildDefaultGlobalConfig(kaelHome: string): KaelGlobalConfig {
  const dataDir = path.join(kaelHome, "data");
  return {
    version: 1,
    defaults: {
      host: "127.0.0.1",
      port: 3210,
      dataDir: withHomePlaceholder(dataDir),
      engineMode: "simple",
      idempotency: {
        enabled: true,
        ttlMs: 10 * 60 * 1000,
      },
      pi: {
        provider: "openai",
        transport: "pi_sdk",
        apiUrl: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        timeoutMs: 45000,
        local: {
          command: "pi",
          args: [],
        },
        retry: {
          attempts: 3,
          baseDelayMs: 300,
          maxDelayMs: 3000,
          jitterMs: 250,
        },
      },
    },
  };
}

export async function loadGlobalConfig(): Promise<KaelGlobalConfig | null> {
  const configPath = resolveKaelGlobalConfigPath();
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    return JSON.parse(raw) as KaelGlobalConfig;
  } catch {
    return null;
  }
}

export async function initKaelHome(force = false): Promise<InitKaelHomeResult> {
  const kaelHome = resolveKaelHome();
  const dataDir = path.join(kaelHome, "data");
  const logsDir = path.join(kaelHome, "logs");
  const configPath = resolveKaelGlobalConfigPath();

  await fs.mkdir(kaelHome, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  const defaultConfig = buildDefaultGlobalConfig(kaelHome);

  let created = false;
  if (force) {
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
    created = true;
  } else {
    try {
      await fs.access(configPath);
    } catch {
      await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
      created = true;
    }
  }

  return {
    kaelHome,
    configPath,
    created,
  };
}
