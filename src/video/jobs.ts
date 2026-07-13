import type { JobRecord } from "../types.js";
import type { JobInput, JobService } from "../jobs/service.js";
import {
  validateExistingInputPath,
  validateOutputPath,
  validateStreamUrl,
  validateUserArgs,
} from "./safety.js";

type VideoJobOptions = {
  safePathsEnabled: boolean;
  allowedPaths: string[];
  maxJobArgs: number;
};

type VideoJobDeps = {
  jobs: JobService;
  options: VideoJobOptions;
};

/** Video command builders. Process lifecycle belongs to ProcessSupervisor. */
export function createVideoJobs({ jobs, options }: VideoJobDeps) {
  const inputPath = (value: string, label: string) => validateExistingInputPath({
    value,
    label,
    allowedRoots: options.allowedPaths,
    safePathsEnabled: options.safePathsEnabled,
  });
  const outputPath = (value: string, label: string) => validateOutputPath({
    value,
    label,
    allowedRoots: options.allowedPaths,
    safePathsEnabled: options.safePathsEnabled,
  });
  const enqueue = (input: JobInput): Promise<JobRecord> => jobs.enqueue(input);

  return {
    async startTranscode(params: { sessionKey: string; inputPath: string; outputPath: string; args?: string[] }) {
      await inputPath(params.inputPath, "inputPath");
      outputPath(params.outputPath, "outputPath");
      const customArgs = validateUserArgs(params.args, options.maxJobArgs);
      const codecArgs = customArgs.length > 0 ? customArgs : ["-c:v", "libx264", "-c:a", "aac"];
      return enqueue({
        sessionKey: params.sessionKey,
        command: "ffmpeg",
        input: params.inputPath,
        output: params.outputPath,
        args: ["-y", "-i", params.inputPath, ...codecArgs, params.outputPath],
      });
    },

    async startConvertHls(params: {
      sessionKey: string;
      inputPath: string;
      outputPlaylistPath: string;
      segmentTime?: number;
    }) {
      await inputPath(params.inputPath, "inputPath");
      outputPath(params.outputPlaylistPath, "outputPlaylistPath");
      const segmentTime = Number.isFinite(params.segmentTime) && (params.segmentTime ?? 0) > 0
        ? Math.floor(params.segmentTime ?? 10)
        : 10;
      return enqueue({
        sessionKey: params.sessionKey,
        command: "ffmpeg",
        input: params.inputPath,
        output: params.outputPlaylistPath,
        args: [
          "-y", "-i", params.inputPath, "-c", "copy", "-start_number", "0", "-hls_time",
          String(segmentTime), "-hls_list_size", "0", "-f", "hls", params.outputPlaylistPath,
        ],
      });
    },

    async startCaptureStream(params: {
      sessionKey: string;
      streamUrl: string;
      outputPath: string;
      durationSeconds?: number;
    }) {
      validateStreamUrl(params.streamUrl);
      outputPath(params.outputPath, "outputPath");
      const duration = Number.isFinite(params.durationSeconds) && (params.durationSeconds ?? 0) > 0
        ? ["-t", String(Math.min(21600, Math.floor(params.durationSeconds ?? 0)))]
        : [];
      return enqueue({
        sessionKey: params.sessionKey,
        command: "ffmpeg",
        input: params.streamUrl,
        output: params.outputPath,
        args: ["-y", "-i", params.streamUrl, ...duration, "-c", "copy", params.outputPath],
      });
    },

    async startPlayVlc(params: { sessionKey: string; input: string }) {
      const input = params.input.trim();
      if (!input) throw new Error("input is required");
      if (/^https?:\/\//i.test(input)) validateStreamUrl(input);
      else await inputPath(input, "input");
      return enqueue({ sessionKey: params.sessionKey, command: "vlc", input, args: [input] });
    },
  };
}

export type VideoJobs = ReturnType<typeof createVideoJobs>;
