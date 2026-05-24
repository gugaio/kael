import { loadConfig } from "../config.js";

export type UrlOption = {
  url?: string;
};

type ApiErrorShape = {
  message?: string;
};

export function extractApiErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const legacy = (data as { error?: unknown }).error;
  if (typeof legacy === "string" && legacy.trim()) {
    return legacy;
  }

  if (legacy && typeof legacy === "object") {
    const message = (legacy as ApiErrorShape).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return null;
}

export function highlight(text: string): string {
  if (!process.stdout.isTTY) {
    return text;
  }
  return `\x1b[38;5;226m${text}\x1b[0m`;
}

export function optionalNumber(value: string | undefined, label: string): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} deve ser numerico`);
  }
  return parsed;
}

export function optionalTimeSeconds(value: string | undefined, label: string): number | undefined {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }
  if (!raw.includes(":")) {
    return optionalNumber(raw, label);
  }
  const parts = raw.split(":").map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error(`${label} deve ser segundos, mm:ss ou hh:mm:ss`);
  }
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(3)}s`;
}

export async function resolveUrl(explicit?: string): Promise<string> {
  if (explicit) {
    return explicit;
  }

  const cfg = await loadConfig();
  return `http://${cfg.host}:${cfg.port}`;
}
