import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";

export type SchedulerJob = {
  id: string;
  type: string;
  enabled: boolean;
  intervalMs: number;
  nextRunAt: string;
  lastRunAt?: string;
};

type SchedulerStore = {
  jobs: Record<string, SchedulerJob>;
};

type SchedulerRunParams = {
  job: SchedulerJob;
  now: Date;
  isCatchUp: boolean;
};

export class PersistentScheduler {
  private readonly jobs: Map<string, SchedulerJob> = new Map();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly storePath: string,
    private readonly tickMs: number,
    private readonly onRun: (params: SchedulerRunParams) => Promise<void>,
  ) {}

  async init(): Promise<void> {
    await ensureDir(path.dirname(this.storePath));
    const loaded = await readJsonFile<SchedulerStore>(this.storePath, { jobs: {} });
    for (const job of Object.values(loaded.jobs)) {
      this.jobs.set(job.id, job);
    }
    await this.persist();
  }

  async upsertIntervalJob(params: {
    id: string;
    type: string;
    intervalMs: number;
    enabled: boolean;
  }): Promise<void> {
    const existing = this.jobs.get(params.id);
    const now = new Date();
    const base = existing ?? {
      id: params.id,
      type: params.type,
      enabled: params.enabled,
      intervalMs: params.intervalMs,
      nextRunAt: new Date(now.getTime() + params.intervalMs).toISOString(),
    };

    const next: SchedulerJob = {
      ...base,
      type: params.type,
      intervalMs: params.intervalMs,
      enabled: params.enabled,
      nextRunAt:
        existing?.intervalMs !== params.intervalMs
          ? new Date(now.getTime() + params.intervalMs).toISOString()
          : base.nextRunAt,
    };
    this.jobs.set(next.id, next);
    await this.persist();
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const now = new Date();
    let changed = false;

    for (const [jobId, job] of this.jobs.entries()) {
      if (!job.enabled) {
        continue;
      }

      const nextRunMs = Date.parse(job.nextRunAt);
      if (!Number.isFinite(nextRunMs) || now.getTime() < nextRunMs) {
        continue;
      }

      const isCatchUp = now.getTime() - nextRunMs > job.intervalMs;
      try {
        await this.onRun({ job, now, isCatchUp });
      } catch (error) {
        console.error("[scheduler] job execution failed", {
          jobId: job.id,
          type: job.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      let nextMs = nextRunMs;
      while (nextMs <= now.getTime()) {
        nextMs += job.intervalMs;
      }

      this.jobs.set(jobId, {
        ...job,
        lastRunAt: now.toISOString(),
        nextRunAt: new Date(nextMs).toISOString(),
      });
      changed = true;
    }

    if (changed) {
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const payload: SchedulerStore = {
      jobs: Object.fromEntries(this.jobs.entries()),
    };
    await writeJsonFile(this.storePath, payload);
  }
}
