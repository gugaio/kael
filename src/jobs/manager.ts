import fs from "node:fs/promises";
import type { TranscodeJob } from "../types.js";
import type { JobStore } from "./store.js";
import type { TranscodeService } from "../tools/video/transcode-service.js";

export class JobManager {
  constructor(
    private readonly store: JobStore,
    private readonly transcode: TranscodeService,
  ) {}

  listJobs(): TranscodeJob[] {
    return this.store.list();
  }

  getJob(jobId: string): TranscodeJob | null {
    return this.store.get(jobId);
  }

  async getJobLog(jobId: string): Promise<string | null> {
    const job = this.store.get(jobId);
    if (!job) {
      return null;
    }
    return fs.readFile(job.logPath, "utf-8").catch(() => "");
  }

  async startTranscode(params: {
    sessionKey: string;
    inputPath: string;
    outputPath: string;
    args?: string[];
  }): Promise<TranscodeJob> {
    return this.transcode.start(params);
  }
}
