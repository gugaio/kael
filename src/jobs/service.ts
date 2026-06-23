import crypto from "node:crypto";
import fs from "node:fs";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { JobRecord, JobStatus } from "../types.js";
import { kaelLogger } from "../infra/logger.js";
import type { ProcessSupervisor } from "../process/supervisor.js";
import type { JobStore } from "./store.js";

export type JobInput = {
  sessionKey: string;
  command: string;
  input: string;
  output?: string;
  args: string[];
};

type QueuedJob = JobInput & { id: string };

type JobServiceOptions = {
  maxConcurrentJobs: number;
  jobTimeoutMs: number;
  killGraceMs: number;
};

/** Persistent background-job runtime. Queues, persists, and delegates process execution to ProcessSupervisor. */
export class JobService {
  private readonly queue: QueuedJob[] = [];
  private readonly activeJobs = new Map<string, ChildProcessByStdio<Writable, Readable, Readable>>();
  private readonly canceledJobs = new Set<string>();
  private reservedSlots = 0;

  constructor(
    private readonly store: JobStore,
    private readonly supervisor: ProcessSupervisor,
    private readonly options: JobServiceOptions,
  ) {}

  async enqueue(input: JobInput): Promise<JobRecord> {
    const id = crypto.randomUUID();
    const job: JobRecord = {
      id,
      sessionKey: input.sessionKey,
      command: input.command,
      input: input.input,
      output: input.output,
      args: input.args,
      status: "queued",
      createdAt: new Date().toISOString(),
      logPath: this.store.getLogPath(id),
    };
    await this.store.create(job);
    this.queue.push({ ...input, id });
    this.drainQueue();
    return job;
  }

  listJobs(): JobRecord[] {
    return this.store.list();
  }

  getJob(jobId: string): JobRecord | null {
    return this.store.get(jobId);
  }

  getStatusCounts(): Record<JobStatus, number> {
    return this.store.getStatusCounts();
  }

  async getJobLog(jobId: string): Promise<string | null> {
    const job = this.store.get(jobId);
    return job ? fs.promises.readFile(job.logPath, "utf-8").catch(() => "") : null;
  }

  getRuntimeStats(): { activeJobs: number; queuedJobs: number; maxConcurrentJobs: number } {
    return {
      activeJobs: this.activeJobs.size + this.reservedSlots,
      queuedJobs: this.queue.length,
      maxConcurrentJobs: this.options.maxConcurrentJobs,
    };
  }


  async cancelJob(jobId: string): Promise<{ job: JobRecord | null; canceled: boolean }> {
    const job = this.store.get(jobId);
    if (!job) return { job: null, canceled: false };

    const queuedIndex = this.queue.findIndex((item) => item.id === jobId);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      const updated = await this.store.update(jobId, {
        status: "canceled",
        endedAt: new Date().toISOString(),
        error: "job canceled by user",
      });
      return { job: updated ?? this.store.get(jobId), canceled: true };
    }

    const process = this.activeJobs.get(jobId);
    if (!process) return { job: this.store.get(jobId), canceled: false };

    this.canceledJobs.add(jobId);
    process.kill("SIGTERM");
    const forceHandle = setTimeout(() => {
      if (!process.killed) process.kill("SIGKILL");
    }, this.options.killGraceMs);
    forceHandle.unref();
    return { job: this.store.get(jobId), canceled: true };
  }

  private drainQueue(): void {
    while (this.activeJobs.size + this.reservedSlots < this.options.maxConcurrentJobs) {
      const next = this.queue.shift();
      if (!next) return;
      this.reservedSlots += 1;
      void this.execute(next);
    }
  }

  private async execute(job: QueuedJob): Promise<void> {
    try {
      await this.store.update(job.id, { status: "running", startedAt: new Date().toISOString() });
      const { process, result } = this.supervisor.spawn(job.command, job.args, {
        timeoutMs: this.options.jobTimeoutMs,
        killGraceMs: this.options.killGraceMs,
        logPath: this.store.getLogPath(job.id),
      });
      this.activeJobs.set(job.id, process);
      this.reservedSlots = Math.max(0, this.reservedSlots - 1);

      const outcome = await result;
      const canceled = this.wasCanceled(job.id);

      const error = canceled
        ? "job canceled by user"
        : outcome.error;

      await this.finish(job, {
        code: outcome.exitCode,
        canceled,
        error,
      });
    } catch (error) {
      this.reservedSlots = Math.max(0, this.reservedSlots - 1);
      await this.store.update(job.id, {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      this.drainQueue();
    }
  }

  private wasCanceled(jobId: string): boolean {
    const canceled = this.canceledJobs.has(jobId);
    this.canceledJobs.delete(jobId);
    return canceled;
  }

  private async finish(
    job: QueuedJob,
    result: { code?: number | null; canceled: boolean; error?: string },
  ): Promise<void> {
    if (!this.activeJobs.delete(job.id)) return;
    const status = result.canceled ? "canceled" : result.error ? "failed" : "succeeded";
    await this.store.update(job.id, {
      status,
      endedAt: new Date().toISOString(),
      ...(result.code !== undefined ? { exitCode: result.code } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
    kaelLogger.info("jobs.execution.finished", { jobId: job.id, command: job.command, ...result, status });
    this.drainQueue();
  }
}
