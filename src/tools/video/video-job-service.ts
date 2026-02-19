import crypto from "node:crypto";
import fs from "node:fs";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { JobStore } from "../../jobs/store.js";
import type { VideoJob, VideoJobType } from "../../types.js";
import { kaelLogger } from "../../infra/logger.js";
import type { ProcessRunner } from "../system/process-runner.js";
import {
  validateExistingInputPath,
  validateOutputPath,
  validateStreamUrl,
  validateUserArgs,
} from "./safety.js";

type StartJobParams = {
  id: string;
  type: VideoJobType;
  sessionKey: string;
  command: "ffmpeg" | "ffprobe";
  input: string;
  output?: string;
  args: string[];
};

export class VideoJobService {
  private readonly queue: StartJobParams[] = [];
  private readonly activeJobs: Map<string, ChildProcessWithoutNullStreams> = new Map();
  private reservedSlots = 0;

  constructor(
    private readonly jobs: JobStore,
    private readonly runner: ProcessRunner,
    private readonly safety: {
      safePathsEnabled: boolean;
      allowedPaths: string[];
      maxJobArgs: number;
      maxConcurrentJobs: number;
      jobTimeoutMs: number;
      killGraceMs: number;
    },
  ) {}

  getRuntimeStats(): { activeJobs: number; queuedJobs: number; maxConcurrentJobs: number } {
    return {
      activeJobs: this.activeJobs.size + this.reservedSlots,
      queuedJobs: this.queue.length,
      maxConcurrentJobs: this.safety.maxConcurrentJobs,
    };
  }

  async startTranscode(params: {
    sessionKey: string;
    inputPath: string;
    outputPath: string;
    args?: string[];
  }): Promise<VideoJob> {
    await validateExistingInputPath({
      value: params.inputPath,
      label: "inputPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });
    validateOutputPath({
      value: params.outputPath,
      label: "outputPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });
    const userArgs = validateUserArgs(params.args, this.safety.maxJobArgs);
    const codecArgs = userArgs.length > 0 ? userArgs : ["-c:v", "libx264", "-c:a", "aac"];
    return this.startJob({
      type: "transcode",
      sessionKey: params.sessionKey,
      command: "ffmpeg",
      input: params.inputPath,
      output: params.outputPath,
      args: ["-y", "-i", params.inputPath, ...codecArgs, params.outputPath],
    });
  }

  async startConvertHls(params: {
    sessionKey: string;
    inputPath: string;
    outputPlaylistPath: string;
    segmentTime?: number;
  }): Promise<VideoJob> {
    await validateExistingInputPath({
      value: params.inputPath,
      label: "inputPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });
    validateOutputPath({
      value: params.outputPlaylistPath,
      label: "outputPlaylistPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });

    const segmentTime = Number.isFinite(params.segmentTime) && (params.segmentTime ?? 0) > 0
      ? Math.floor(params.segmentTime ?? 10)
      : 10;

    return this.startJob({
      type: "convert_hls",
      sessionKey: params.sessionKey,
      command: "ffmpeg",
      input: params.inputPath,
      output: params.outputPlaylistPath,
      args: [
        "-y",
        "-i",
        params.inputPath,
        "-c",
        "copy",
        "-start_number",
        "0",
        "-hls_time",
        String(segmentTime),
        "-hls_list_size",
        "0",
        "-f",
        "hls",
        params.outputPlaylistPath,
      ],
    });
  }

  async startCaptureStream(params: {
    sessionKey: string;
    streamUrl: string;
    outputPath: string;
    durationSeconds?: number;
  }): Promise<VideoJob> {
    validateStreamUrl(params.streamUrl);
    validateOutputPath({
      value: params.outputPath,
      label: "outputPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });

    const durationArgs =
      Number.isFinite(params.durationSeconds) && (params.durationSeconds ?? 0) > 0
        ? ["-t", String(Math.min(21600, Math.floor(params.durationSeconds ?? 0)))]
        : [];

    return this.startJob({
      type: "capture_stream",
      sessionKey: params.sessionKey,
      command: "ffmpeg",
      input: params.streamUrl,
      output: params.outputPath,
      args: ["-y", "-i", params.streamUrl, ...durationArgs, "-c", "copy", params.outputPath],
    });
  }

  async startProbeMedia(params: {
    sessionKey: string;
    inputPath: string;
  }): Promise<VideoJob> {
    await validateExistingInputPath({
      value: params.inputPath,
      label: "inputPath",
      allowedRoots: this.safety.allowedPaths,
      safePathsEnabled: this.safety.safePathsEnabled,
    });
    return this.startJob({
      type: "probe_media",
      sessionKey: params.sessionKey,
      command: "ffprobe",
      input: params.inputPath,
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,avg_frame_rate",
        "-of",
        "json",
        params.inputPath,
      ],
    });
  }

  private async startJob(params: Omit<StartJobParams, "id">): Promise<VideoJob> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const initial: VideoJob = {
      id,
      type: params.type,
      sessionKey: params.sessionKey,
      command: params.command,
      input: params.input,
      output: params.output,
      args: params.args,
      status: "queued",
      createdAt,
      logPath: this.jobs.getLogPath(id),
    };

    await this.jobs.create(initial);
    this.queue.push({ ...params, id });
    this.drainQueue();

    return initial;
  }

  private drainQueue(): void {
    while (this.activeJobs.size + this.reservedSlots < this.safety.maxConcurrentJobs) {
      const next = this.queue.shift();
      if (!next) {
        return;
      }
      this.reservedSlots += 1;
      void this.executeJob(next);
    }
  }

  private async executeJob(params: StartJobParams): Promise<void> {
    try {
      await this.jobs.update(params.id, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      const { process } = this.runner.spawn(params.command, params.args);
      this.activeJobs.set(params.id, process);
      this.reservedSlots = Math.max(0, this.reservedSlots - 1);
      const logStream = fs.createWriteStream(this.jobs.getLogPath(params.id), { flags: "a" });

      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        logStream.write(`\n[timeout] ${String(this.safety.jobTimeoutMs)}ms reached, sending SIGTERM\n`);
        process.kill("SIGTERM");
        const forceHandle = setTimeout(() => {
          if (!process.killed) {
            logStream.write("[timeout] process still alive, sending SIGKILL\n");
            process.kill("SIGKILL");
          }
        }, this.safety.killGraceMs);
        forceHandle.unref();
      }, this.safety.jobTimeoutMs);
      timeoutHandle.unref();

      process.stdout.on("data", (chunk) => {
        logStream.write(chunk);
      });
      process.stderr.on("data", (chunk) => {
        logStream.write(chunk);
      });

      process.on("error", async (error) => {
        clearTimeout(timeoutHandle);
        this.activeJobs.delete(params.id);
        await this.jobs.update(params.id, {
          status: "failed",
          endedAt: new Date().toISOString(),
          error: error.message,
        });
        logStream.end(`\n[process-error] ${error.message}\n`);
        kaelLogger.error("jobs.execution.failed", {
          jobId: params.id,
          type: params.type,
          reason: "process_error",
          message: error.message,
        });
        this.drainQueue();
      });

      process.on("close", async (code) => {
        clearTimeout(timeoutHandle);
        this.activeJobs.delete(params.id);
        await this.jobs.update(params.id, {
          status: code === 0 && !timedOut ? "succeeded" : "failed",
          endedAt: new Date().toISOString(),
          exitCode: code,
          error:
            code === 0 && !timedOut
              ? undefined
              : timedOut
                ? `job timed out after ${String(this.safety.jobTimeoutMs)}ms`
                : `${params.command} exited with code ${String(code)}`,
        });
        logStream.end(`\n[process-exit] code=${String(code)}\n`);

        kaelLogger.info("jobs.execution.finished", {
          jobId: params.id,
          type: params.type,
          exitCode: code,
          timedOut,
        });
        this.drainQueue();
      });
    } catch (error) {
      this.reservedSlots = Math.max(0, this.reservedSlots - 1);
      await this.jobs.update(params.id, {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      kaelLogger.error("jobs.execution.failed", {
        jobId: params.id,
        type: params.type,
        reason: "setup_error",
        message: error instanceof Error ? error.message : String(error),
      });
      this.drainQueue();
    }
  }
}
