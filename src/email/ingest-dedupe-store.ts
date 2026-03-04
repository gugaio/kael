import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureDir } from "../infra/fs.js";

export type EmailClaimResult = "claimed" | "duplicate" | "in_flight";

export interface EmailIngestDedupeStore {
  init(): Promise<void>;
  claim(messageKey: string): Promise<EmailClaimResult>;
  markProcessed(messageKey: string): Promise<void>;
  release(messageKey: string): Promise<void>;
}

type FileEmailIngestDedupeStoreOptions = {
  rootDir: string;
  processedTtlMs?: number;
};

export class FileEmailIngestDedupeStore implements EmailIngestDedupeStore {
  private readonly inflightDir: string;
  private readonly processedDir: string;
  private readonly processedTtlMs: number;
  private lastPruneAt = 0;

  constructor(cfg: FileEmailIngestDedupeStoreOptions) {
    this.inflightDir = path.join(cfg.rootDir, "inflight");
    this.processedDir = path.join(cfg.rootDir, "processed");
    this.processedTtlMs = Math.max(60_000, Math.floor(cfg.processedTtlMs ?? 7 * 24 * 60 * 60 * 1000));
  }

  async init(): Promise<void> {
    await ensureDir(this.inflightDir);
    await ensureDir(this.processedDir);
    await this.pruneProcessedIfNeeded();
  }

  async claim(messageKey: string): Promise<EmailClaimResult> {
    await this.pruneProcessedIfNeeded();
    const processedPath = this.processedPath(messageKey);
    if (await pathExists(processedPath)) {
      return "duplicate";
    }

    const inflightPath = this.inflightPath(messageKey);
    try {
      await fs.mkdir(inflightPath);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        return "in_flight";
      }
      throw error;
    }

    // Recheca duplicidade apos lock para evitar corrida com markProcessed de outro worker.
    if (await pathExists(processedPath)) {
      await this.release(messageKey);
      return "duplicate";
    }

    return "claimed";
  }

  async markProcessed(messageKey: string): Promise<void> {
    const filePath = this.processedPath(messageKey);
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(
      filePath,
      JSON.stringify({ key: messageKey, processedAt: new Date().toISOString() }),
      "utf-8",
    );
  }

  async release(messageKey: string): Promise<void> {
    await fs.rm(this.inflightPath(messageKey), { recursive: true, force: true });
  }

  private processedPath(messageKey: string): string {
    return path.join(this.processedDir, `${hashMessageKey(messageKey)}.json`);
  }

  private inflightPath(messageKey: string): string {
    return path.join(this.inflightDir, `${hashMessageKey(messageKey)}.lock`);
  }

  private async pruneProcessedIfNeeded(): Promise<void> {
    const now = Date.now();
    // Evita scan em todo poll.
    if (now - this.lastPruneAt < 10 * 60 * 1000) {
      return;
    }
    this.lastPruneAt = now;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.processedDir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = path.join(this.processedDir, entry.name);
          try {
            const stat = await fs.stat(filePath);
            if (now - stat.mtimeMs > this.processedTtlMs) {
              await fs.rm(filePath, { force: true });
            }
          } catch {
            // best-effort prune
          }
        }),
    );
  }
}

function hashMessageKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "EEXIST",
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
