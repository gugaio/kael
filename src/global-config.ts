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
    context: {
      maxMessages: number;
      maxChars: number;
    };
    idempotency: {
      enabled: boolean;
      ttlMs: number;
    };
    automation: {
      heartbeatEnabled: boolean;
      heartbeatIntervalMs: number;
      plannerReconcileEnabled: boolean;
      plannerReconcileIntervalMs: number;
      schedulerTickMs: number;
    };
    shell: {
      workspaceRoot: string;
      defaultTimeoutMs: number;
      maxTimeoutMs: number;
      maxOutputChars: number;
      approvalWaitMs: number;
      security: "deny" | "allowlist" | "full";
      ask: "off" | "on-miss" | "always";
      allowlist: string[];
    };
    research: {
      enabled: boolean;
      provider: "tavily";
      maxResults: number;
      maxResultsLimit: number;
      timeoutMs: number;
      fetchMaxChars: number;
      fetchCacheTtlMs: number;
      fetchMaxRedirects: number;
      fetchMaxResponseBytes: number;
    };
    pi: {
      provider: string;
      model: string;
      timeoutMs: number;
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
      context: {
        maxMessages: 24,
        maxChars: 12000,
      },
      idempotency: {
        enabled: true,
        ttlMs: 10 * 60 * 1000,
      },
      automation: {
        heartbeatEnabled: true,
        heartbeatIntervalMs: 30000,
        plannerReconcileEnabled: true,
        plannerReconcileIntervalMs: 30000,
        schedulerTickMs: 1000,
      },
      shell: {
        workspaceRoot: ".",
        defaultTimeoutMs: 60_000,
        maxTimeoutMs: 15 * 60_000,
        maxOutputChars: 120_000,
        approvalWaitMs: 120_000,
        security: "allowlist",
        ask: "on-miss",
        allowlist: [
          "ls",
          "cat",
          "pwd",
          "echo",
          "grep",
          "find",
          "curl",
          "ffmpeg",
          "ffprobe",
          "vlc",
        ],
      },
      research: {
        enabled: false,
        provider: "tavily",
        maxResults: 5,
        maxResultsLimit: 10,
        timeoutMs: 12000,
        fetchMaxChars: 12000,
        fetchCacheTtlMs: 10 * 60 * 1000,
        fetchMaxRedirects: 3,
        fetchMaxResponseBytes: 2_000_000,
      },
      pi: {
        provider: "openai",
        model: "gpt-4o-mini",
        timeoutMs: 45000,
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
