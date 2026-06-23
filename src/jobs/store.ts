import path from "node:path";
import type { JobRecord, JobStatus } from "../types.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";

type JobIndex = {
  jobs: Record<string, JobRecord>;
};

function migrateLegacyJob(raw: Partial<JobRecord>): JobRecord | null {
  const job = raw as Record<string, unknown>;
  if (
    typeof job.id !== "string" ||
    typeof job.sessionKey !== "string" ||
    typeof job.command !== "string" ||
    typeof job.input !== "string" ||
    !Array.isArray(job.args) ||
    typeof job.status !== "string" ||
    typeof job.createdAt !== "string" ||
    typeof job.logPath !== "string"
  ) {
    return null;
  }
  return {
    id: job.id,
    sessionKey: job.sessionKey,
    command: job.command,
    input: job.input,
    output: typeof job.output === "string" ? job.output : undefined,
    args: job.args.filter((value): value is string => typeof value === "string"),
    status: job.status as JobStatus,
    createdAt: job.createdAt,
    startedAt: typeof job.startedAt === "string" ? job.startedAt : undefined,
    endedAt: typeof job.endedAt === "string" ? job.endedAt : undefined,
    exitCode: typeof job.exitCode === "number" || job.exitCode === null ? job.exitCode : undefined,
    error: typeof job.error === "string" ? job.error : undefined,
    logPath: job.logPath,
  };
}

export class JobStore {
  private readonly jobsPath: string;
  private readonly logsDir: string;
  private jobs: Map<string, JobRecord> = new Map();

  constructor(dataDir: string) {
    const jobsDir = path.join(dataDir, "jobs");
    this.jobsPath = path.join(jobsDir, "jobs.json");
    this.logsDir = path.join(jobsDir, "logs");
  }

  async init(): Promise<void> {
    await ensureDir(this.logsDir);
    const loaded = await readJsonFile<{ jobs: Record<string, Partial<JobRecord>> }>(
      this.jobsPath,
      { jobs: {} },
    );
    this.jobs = new Map(
      Object.values(loaded.jobs)
        .map((job) => migrateLegacyJob(job))
        .filter((job): job is JobRecord => job !== null)
        .map((job) => [job.id, job]),
    );
    await this.persist();
  }

  getLogPath(jobId: string): string {
    return path.join(this.logsDir, `${jobId}.log`);
  }

  async create(job: JobRecord): Promise<JobRecord> {
    this.jobs.set(job.id, job);
    await this.persist();
    return job;
  }

  async update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    const current = this.jobs.get(jobId);
    if (!current) {
      return null;
    }
    const next = { ...current, ...patch };
    this.jobs.set(jobId, next);
    await this.persist();
    return next;
  }

  get(jobId: string): JobRecord | null {
    return this.jobs.get(jobId) ?? null;
  }

  list(): JobRecord[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getStatusCounts(): Record<JobStatus, number> {
    const counts: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
    };
    for (const job of this.jobs.values()) {
      counts[job.status] += 1;
    }
    return counts;
  }

  private async persist(): Promise<void> {
    const payload: JobIndex = {
      jobs: Object.fromEntries(this.jobs.entries()),
    };
    await writeJsonFile(this.jobsPath, payload);
  }
}
