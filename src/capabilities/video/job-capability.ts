import type { VideoJobService } from "./job-service.js";
import type { VideoJob } from "../../types.js";
import type { JobCapability } from "../../jobs/capabilities.js";

export const VIDEO_JOB_ACTIONS = {
  transcode: "transcode",
  convertHls: "convert_hls",
  captureStream: "capture_stream",
  probeMedia: "probe_media",
  playVlc: "play_vlc",
  probeUrl: "probe_url",
} as const;

type JobActionParams = Parameters<(typeof VideoJobService)["prototype"]["startTranscode"]>[0];
type ConvertHlsParams = Parameters<(typeof VideoJobService)["prototype"]["startConvertHls"]>[0];
type CaptureStreamParams = Parameters<(typeof VideoJobService)["prototype"]["startCaptureStream"]>[0];
type ProbeMediaParams = Parameters<(typeof VideoJobService)["prototype"]["startProbeMedia"]>[0];
type PlayVlcParams = Parameters<(typeof VideoJobService)["prototype"]["startPlayVlc"]>[0];
type ProbeUrlParams = Parameters<(typeof VideoJobService)["prototype"]["startProbeUrl"]>[0];

export class VideoCapability implements JobCapability {
  readonly name = "video";

  readonly actions = {
    [VIDEO_JOB_ACTIONS.transcode]: (params: unknown): Promise<VideoJob> =>
      this.video.startTranscode(params as JobActionParams),
    [VIDEO_JOB_ACTIONS.convertHls]: (params: unknown): Promise<VideoJob> =>
      this.video.startConvertHls(params as ConvertHlsParams),
    [VIDEO_JOB_ACTIONS.captureStream]: (params: unknown): Promise<VideoJob> =>
      this.video.startCaptureStream(params as CaptureStreamParams),
    [VIDEO_JOB_ACTIONS.probeMedia]: (params: unknown): Promise<VideoJob> =>
      this.video.startProbeMedia(params as ProbeMediaParams),
    [VIDEO_JOB_ACTIONS.playVlc]: (params: unknown): Promise<VideoJob> =>
      this.video.startPlayVlc(params as PlayVlcParams),
    [VIDEO_JOB_ACTIONS.probeUrl]: (params: unknown): Promise<VideoJob> =>
      this.video.startProbeUrl(params as ProbeUrlParams),
  };

  constructor(private readonly video: VideoJobService) {}

  getRuntimeStats() {
    return this.video.getRuntimeStats();
  }

  async cancelJob(jobId: string): Promise<{ job: VideoJob | null; canceled: boolean }> {
    return this.video.cancelJob(jobId);
  }
}
