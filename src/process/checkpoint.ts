/**
 * Checkpoint de processos ativos — resiliência a restart.
 *
 * Persiste PIDs + start time + metadata em disco para que,
 * após um restart do Kael, processos em background possam
 * ser recuperados em vez de perdidos.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { kaelLogger } from "../infra/logger.js";

export type ProcessCheckpoint = {
  pid: number;
  kind: "shell" | "job";
  sessionKey: string;
  jobId?: string;
  command: string;
  startedAt: string;
};

export type CheckpointFile = {
  version: 2;
  processes: ProcessCheckpoint[];
  updatedAt: string;
};

/**
 * Gerencia checkpoint de processos em disco.
 * Salva em `{dataDir}/process-checkpoint.json`.
 */
export class ProcessCheckpointStore {
  private readonly filePath: string;
  private processes: ProcessCheckpoint[] = [];

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "process-checkpoint.json");
  }

  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as CheckpointFile;
      if (parsed.version === 2 && Array.isArray(parsed.processes)) {
        this.processes = parsed.processes;
        kaelLogger.info("checkpoint.loaded", { count: this.processes.length });
      }
    } catch {
      this.processes = [];
    }
    // Salva estado inicial (vazio ou recuperado)
    await this.flush();
  }

  async track(checkpoint: ProcessCheckpoint): Promise<void> {
    this.processes.push(checkpoint);
    await this.flush();
  }

  async untrack(pid: number): Promise<void> {
    const before = this.processes.length;
    this.processes = this.processes.filter((p) => p.pid !== pid);
    if (this.processes.length !== before) {
      await this.flush();
    }
  }

  async untrackBySessionKey(sessionKey: string): Promise<void> {
    const before = this.processes.length;
    this.processes = this.processes.filter((p) => p.sessionKey !== sessionKey);
    if (this.processes.length !== before) {
      await this.flush();
    }
  }

  /** Retorna cópia dos processos em checkpoint. */
  list(): ProcessCheckpoint[] {
    return [...this.processes];
  }

  async flush(): Promise<void> {
    const payload: CheckpointFile = {
      version: 2,
      processes: this.processes,
      updatedAt: new Date().toISOString(),
    };
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = path.join(dir, "process-checkpoint.tmp");
    await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
    await fs.rename(tmpPath, this.filePath);
  }
}
