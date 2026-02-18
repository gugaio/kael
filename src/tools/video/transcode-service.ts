import crypto from "node:crypto";
import fs from "node:fs";
import type { JobStore } from "../../jobs/store.js";
import type { TranscodeJob } from "../../types.js";
import type { ProcessRunner } from "../system/process-runner.js";

export class TranscodeService {
  constructor(
    private readonly jobs: JobStore,
    private readonly runner: ProcessRunner,
  ) {}

  async start(params: {
    sessionKey: string;
    inputPath: string;
    outputPath: string;
    args?: string[];
  }): Promise<TranscodeJob> {
    const jobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const extraArgs = params.args ?? ["-c:v", "libx264", "-c:a", "aac"];
    const ffmpegArgs = ["-y", "-i", params.inputPath, ...extraArgs, params.outputPath];

    const initial: TranscodeJob = {
      id: jobId,
      type: "transcode",
      sessionKey: params.sessionKey,
      inputPath: params.inputPath,
      outputPath: params.outputPath,
      args: ffmpegArgs,
      status: "queued",
      createdAt,
      logPath: this.jobs.getLogPath(jobId),
    };

    await this.jobs.create(initial);

    const runningAt = new Date().toISOString();
    await this.jobs.update(jobId, {
      status: "running",
      startedAt: runningAt,
    });

    const { process } = this.runner.spawn("ffmpeg", ffmpegArgs);
    const logStream = fs.createWriteStream(initial.logPath, { flags: "a" });

    process.stdout.on("data", (chunk) => {
      logStream.write(chunk);
    });

    process.stderr.on("data", (chunk) => {
      logStream.write(chunk);
    });

    process.on("error", async (error) => {
      await this.jobs.update(jobId, {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: error.message,
      });
      logStream.end(`\n[process-error] ${error.message}\n`);
    });

    process.on("close", async (code) => {
      await this.jobs.update(jobId, {
        status: code === 0 ? "succeeded" : "failed",
        endedAt: new Date().toISOString(),
        exitCode: code,
        error: code === 0 ? undefined : `ffmpeg exited with code ${code}`,
      });
      logStream.end(`\n[process-exit] code=${String(code)}\n`);
    });

    const current = this.jobs.get(jobId);
    if (!current) {
      throw new Error("Failed to create transcode job");
    }
    return current;
  }
}
