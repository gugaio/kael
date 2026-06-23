import type { JobRecord } from "../types.js";
import type { JobService } from "../jobs/service.js";
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
  const enqueue = (input: {
    action: string;
    sessionKey: string;
    command: string;
    input: string;
    output?: string;
    args: string[];
  }): Promise<JobRecord> => jobs.enqueue({ capability: "video", ...input });

  return {
    async startTranscode(params: { sessionKey: string; inputPath: string; outputPath: string; args?: string[] }) {
      await inputPath(params.inputPath, "inputPath");
      outputPath(params.outputPath, "outputPath");
      const customArgs = validateUserArgs(params.args, options.maxJobArgs);
      const codecArgs = customArgs.length > 0 ? customArgs : ["-c:v", "libx264", "-c:a", "aac"];
      return enqueue({
        action: "transcode",
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
        action: "convert_hls",
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
        action: "capture_stream",
        sessionKey: params.sessionKey,
        command: "ffmpeg",
        input: params.streamUrl,
        output: params.outputPath,
        args: ["-y", "-i", params.streamUrl, ...duration, "-c", "copy", params.outputPath],
      });
    },

    async startProbeMedia(params: { sessionKey: string; inputPath: string }) {
      await inputPath(params.inputPath, "inputPath");
      return enqueue({
        action: "probe_media",
        sessionKey: params.sessionKey,
        command: "ffprobe",
        input: params.inputPath,
        args: ["-v", "error", "-show_entries", "format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,avg_frame_rate", "-of", "json", params.inputPath],
      });
    },

    async startProbeUrl(params: { sessionKey: string; streamUrl: string }) {
      validateStreamUrl(params.streamUrl);
      return enqueue({
        action: "probe_url",
        sessionKey: params.sessionKey,
        command: "ffprobe",
        input: params.streamUrl,
        args: ["-v", "error", "-show_entries", "format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,avg_frame_rate", "-of", "json", params.streamUrl],
      });
    },

    async startPlayVlc(params: { sessionKey: string; input: string }) {
      const input = params.input.trim();
      if (!input) throw new Error("input is required");
      if (/^https?:\/\//i.test(input)) validateStreamUrl(input);
      else await inputPath(input, "input");
      return enqueue({ action: "play_vlc", sessionKey: params.sessionKey, command: "vlc", input, args: [input] });
    },
  };
}

export type VideoJobs = ReturnType<typeof createVideoJobs>;
