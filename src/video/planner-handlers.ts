import type { ActionHandler } from "../planner/action-registry.js";
import type { VideoJobs } from "./jobs.js";

export function createVideoPlannerHandlers(videoJobs: VideoJobs): Record<string, ActionHandler> {
  return {
    probe: {
      requiredInputs: ["inputPath"],
      execute: async ({ sessionKey, inputs }) => {
        const job = await videoJobs.startProbeMedia({
          sessionKey,
          inputPath: inputs.inputPath ?? "",
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
    capture: {
      requiredInputs: ["streamUrl", "outputPath"],
      execute: async ({ sessionKey, inputs }) => {
        const job = await videoJobs.startCaptureStream({
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
        const job = await videoJobs.startTranscode({
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
        const job = await videoJobs.startConvertHls({
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
