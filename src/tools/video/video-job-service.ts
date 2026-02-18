import crypto from "node:crypto";
import fs from "node:fs";
import type { JobStore } from "../../jobs/store.js";
import type { VideoJob, VideoJobType } from "../../types.js";
import type { ProcessRunner } from "../system/process-runner.js";

type StartJobParams = {
  type: VideoJobType;
  sessionKey: string;
  command: "ffmpeg" | "ffprobe";
  input: string;
  output?: string;
  args: string[];
};

export class VideoJobService {
  constructor(
    private readonly jobs: JobStore,
    private readonly runner: ProcessRunner,
  ) {}

  async startTranscode(params: {
    sessionKey: string;
    inputPath: string;
    outputPath: string;
    args?: string[];
  }): Promise<VideoJob> {
    const codecArgs = params.args ?? ["-c:v", "libx264", "-c:a", "aac"];
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
    const durationArgs =
      Number.isFinite(params.durationSeconds) && (params.durationSeconds ?? 0) > 0
        ? ["-t", String(Math.floor(params.durationSeconds ?? 0))]
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

  private async startJob(params: StartJobParams): Promise<VideoJob> {
    const jobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const initial: VideoJob = {
      id: jobId,
      type: params.type,
      sessionKey: params.sessionKey,
      command: params.command,
      input: params.input,
      output: params.output,
      args: params.args,
      status: "queued",
      createdAt,
      logPath: this.jobs.getLogPath(jobId),
    };

    await this.jobs.create(initial);
    await this.jobs.update(jobId, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    const { process } = this.runner.spawn(params.command, params.args);
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
        error: code === 0 ? undefined : `${params.command} exited with code ${String(code)}`,
      });
      logStream.end(`\n[process-exit] code=${String(code)}\n`);
    });

    const current = this.jobs.get(jobId);
    if (!current) {
      throw new Error("Failed to create video job");
    }
    return current;
  }
}
