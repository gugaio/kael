import path from "node:path";
import type { TranscodeJob } from "../types.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";

type JobIndex = {
  jobs: Record<string, TranscodeJob>;
};

export class JobStore {
  private readonly jobsPath: string;
  private readonly logsDir: string;
  private jobs: Map<string, TranscodeJob> = new Map();

  constructor(dataDir: string) {
    const jobsDir = path.join(dataDir, "jobs");
    this.jobsPath = path.join(jobsDir, "jobs.json");
    this.logsDir = path.join(jobsDir, "logs");
  }

  async init(): Promise<void> {
    await ensureDir(this.logsDir);
    const loaded = await readJsonFile<JobIndex>(this.jobsPath, { jobs: {} });
    this.jobs = new Map(Object.entries(loaded.jobs));
    await this.persist();
  }

  getLogPath(jobId: string): string {
    return path.join(this.logsDir, `${jobId}.log`);
  }

  async create(job: TranscodeJob): Promise<TranscodeJob> {
    this.jobs.set(job.id, job);
    await this.persist();
    return job;
  }

  async update(jobId: string, patch: Partial<TranscodeJob>): Promise<TranscodeJob | null> {
    const current = this.jobs.get(jobId);
    if (!current) {
      return null;
    }
    const next = { ...current, ...patch };
    this.jobs.set(jobId, next);
    await this.persist();
    return next;
  }

  get(jobId: string): TranscodeJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  list(): TranscodeJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async persist(): Promise<void> {
    const payload: JobIndex = {
      jobs: Object.fromEntries(this.jobs.entries()),
    };
    await writeJsonFile(this.jobsPath, payload);
  }
}
