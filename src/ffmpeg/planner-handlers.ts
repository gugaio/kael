import type { ActionHandler } from "../planner/action-registry.js";
import type { FfmpegJobs } from "./jobs.js";

export function createFfmpegPlannerHandlers(ffmpeg: FfmpegJobs): Record<string, ActionHandler> {
  return {
    capture: {
      requiredInputs: ["streamUrl", "outputPath"],
      execute: async ({ sessionKey, inputs }) => {
        const job = await ffmpeg.startCaptureStream({
          sessionKey,
          streamUrl: inputs.streamUrl ?? "",
          outputPath: inputs.outputPath ?? "",
          durationSeconds: inputs.durationSeconds,
        });
        return {
          ok: true,
          execution: {
            kind: "job",
            refId: job.id,
            status: job.status,
            startedAt: new Date().toISOString(),
          },
        };
      },
    },
    transcode: {
      requiredInputs: ["inputPath", "outputPath"],
      execute: async ({ sessionKey, inputs }) => {
        const job = await ffmpeg.startTranscode({
          sessionKey,
          inputPath: inputs.inputPath ?? "",
          outputPath: inputs.outputPath ?? "",
          args: inputs.args,
        });
        return {
          ok: true,
          execution: {
            kind: "job",
            refId: job.id,
            status: job.status,
            startedAt: new Date().toISOString(),
          },
        };
      },
    },
    hls: {
      requiredInputs: ["inputPath", "outputPlaylistPath"],
      execute: async ({ sessionKey, inputs }) => {
        const job = await ffmpeg.startConvertHls({
          sessionKey,
          inputPath: inputs.inputPath ?? "",
          outputPlaylistPath: inputs.outputPlaylistPath ?? "",
          segmentTime: inputs.segmentTime,
        });
        return {
          ok: true,
          execution: {
            kind: "job",
            refId: job.id,
            status: job.status,
            startedAt: new Date().toISOString(),
          },
        };
      },
    },
  };
}
