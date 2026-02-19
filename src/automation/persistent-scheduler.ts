import path from "node:path";
import { computeNextCronRun, parseCronExpression } from "./cron.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";
import { kaelLogger } from "../infra/logger.js";

export type SchedulerJobSchedule =
  | {
      kind: "interval";
      intervalMs: number;
    }
  | {
      kind: "cron";
      cronExpr: string;
    };

export type SchedulerJob = {
  id: string;
  type: string;
  enabled: boolean;
  schedule: SchedulerJobSchedule;
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
    for (const rawJob of Object.values(loaded.jobs)) {
      // Migração de formato legado: intervalMs na raiz.
      const legacyInterval = (rawJob as { intervalMs?: unknown }).intervalMs;
      const nextJob: SchedulerJob = legacyInterval
        ? {
            ...rawJob,
            schedule: {
              kind: "interval",
              intervalMs: Number(legacyInterval),
            },
          }
        : rawJob;
      this.jobs.set(nextJob.id, nextJob);
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
      nextRunAt: new Date(now.getTime() + params.intervalMs).toISOString(),
    };

    const nextRunAtChanged =
      existing?.schedule.kind !== "interval" ||
      existing.schedule.intervalMs !== params.intervalMs;

    const next: SchedulerJob = {
      ...base,
      type: params.type,
      schedule: {
        kind: "interval",
        intervalMs: params.intervalMs,
      },
      enabled: params.enabled,
      nextRunAt: nextRunAtChanged
        ? new Date(now.getTime() + params.intervalMs).toISOString()
        : base.nextRunAt,
    };
    this.jobs.set(next.id, next);
    await this.persist();
  }

  async upsertCronJob(params: {
    id: string;
    type: string;
    cronExpr: string;
    enabled: boolean;
  }): Promise<void> {
    parseCronExpression(params.cronExpr);
    const existing = this.jobs.get(params.id);
    const now = new Date();
    const base = existing ?? {
      id: params.id,
      type: params.type,
      enabled: params.enabled,
      schedule: {
        kind: "cron" as const,
        cronExpr: params.cronExpr,
      },
      nextRunAt: computeNextCronRun(params.cronExpr, now).toISOString(),
    };

    const nextExprChanged =
      existing?.schedule.kind !== "cron" || existing.schedule.cronExpr !== params.cronExpr;
    const next: SchedulerJob = {
      ...base,
      type: params.type,
      enabled: params.enabled,
      schedule: {
        kind: "cron",
        cronExpr: params.cronExpr,
      },
      nextRunAt: nextExprChanged ? computeNextCronRun(params.cronExpr, now).toISOString() : base.nextRunAt,
    };
    this.jobs.set(next.id, next);
    await this.persist();
  }

  listJobs(): SchedulerJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  getJob(id: string): SchedulerJob | null {
    return this.jobs.get(id) ?? null;
  }

  async setJobEnabled(id: string, enabled: boolean): Promise<SchedulerJob | null> {
    const current = this.jobs.get(id);
    if (!current) {
      return null;
    }
    const now = new Date();
    const nextRunAt = enabled ? this.computeNextRunAt(current.schedule, now).toISOString() : current.nextRunAt;
    const next: SchedulerJob = { ...current, enabled, nextRunAt };
    this.jobs.set(id, next);
    await this.persist();
    return next;
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

      const isCatchUp = now.getTime() > nextRunMs;
      const startedAt = Date.now();
      try {
        await this.onRun({ job, now, isCatchUp });
        kaelLogger.info("scheduler.job.executed", {
          scheduleId: job.id,
          type: job.type,
          isCatchUp,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        kaelLogger.error("scheduler.job.failed", {
          scheduleId: job.id,
          type: job.type,
          isCatchUp,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const nextRunAt = this.computeNextRunAt(job.schedule, now);

      this.jobs.set(jobId, {
        ...job,
        lastRunAt: now.toISOString(),
        nextRunAt: nextRunAt.toISOString(),
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

  private computeNextRunAt(schedule: SchedulerJobSchedule, from: Date): Date {
    if (schedule.kind === "interval") {
      return new Date(from.getTime() + schedule.intervalMs);
    }
    return computeNextCronRun(schedule.cronExpr, from);
  }
}
