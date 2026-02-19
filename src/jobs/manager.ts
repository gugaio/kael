import fs from "node:fs/promises";
import type { JobStatus, VideoJob } from "../types.js";
import type { JobStore } from "./store.js";
import type { VideoJobService } from "../tools/video/video-job-service.js";

export class JobManager {
  constructor(
    private readonly store: JobStore,
    private readonly video: VideoJobService,
  ) {}

  listJobs(): VideoJob[] {
    return this.store.list();
  }

  getStatusCounts(): Record<JobStatus, number> {
    return this.store.getStatusCounts();
  }

  getJob(jobId: string): VideoJob | null {
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
  }): Promise<VideoJob> {
    return this.video.startTranscode(params);
  }

  async startConvertHls(params: {
    sessionKey: string;
    inputPath: string;
    outputPlaylistPath: string;
    segmentTime?: number;
  }): Promise<VideoJob> {
    return this.video.startConvertHls(params);
  }

  async startCaptureStream(params: {
    sessionKey: string;
    streamUrl: string;
    outputPath: string;
    durationSeconds?: number;
  }): Promise<VideoJob> {
    return this.video.startCaptureStream(params);
  }

  async startProbeMedia(params: {
    sessionKey: string;
    inputPath: string;
  }): Promise<VideoJob> {
    return this.video.startProbeMedia(params);
  }
}
