import type { VideoJobService } from "./job-service.js";
import type { VideoJob } from "../../types.js";
import type { JobCapability } from "../../jobs/capabilities.js";
import {
  parseStartCaptureStreamParams,
  parseStartConvertHlsParams,
  parseStartPlayVlcParams,
  parseStartProbeMediaParams,
  parseStartProbeUrlParams,
  parseStartTranscodeParams,
} from "./job-contracts.js";

export const VIDEO_JOB_ACTIONS = {
  transcode: "transcode",
  convertHls: "convert_hls",
  captureStream: "capture_stream",
  probeMedia: "probe_media",
  playVlc: "play_vlc",
  probeUrl: "probe_url",
} as const;

export class VideoCapability implements JobCapability {
  readonly name = "video";

  readonly actions = {
    [VIDEO_JOB_ACTIONS.transcode]: (params: unknown): Promise<VideoJob> =>
      this.video.startTranscode(parseStartTranscodeParams(params)),
    [VIDEO_JOB_ACTIONS.convertHls]: (params: unknown): Promise<VideoJob> =>
      this.video.startConvertHls(parseStartConvertHlsParams(params)),
    [VIDEO_JOB_ACTIONS.captureStream]: (params: unknown): Promise<VideoJob> =>
      this.video.startCaptureStream(parseStartCaptureStreamParams(params)),
    [VIDEO_JOB_ACTIONS.probeMedia]: (params: unknown): Promise<VideoJob> =>
      this.video.startProbeMedia(parseStartProbeMediaParams(params)),
    [VIDEO_JOB_ACTIONS.playVlc]: (params: unknown): Promise<VideoJob> =>
      this.video.startPlayVlc(parseStartPlayVlcParams(params)),
    [VIDEO_JOB_ACTIONS.probeUrl]: (params: unknown): Promise<VideoJob> =>
      this.video.startProbeUrl(parseStartProbeUrlParams(params)),
  };

  constructor(private readonly video: VideoJobService) {}

  getRuntimeStats() {
    return this.video.getRuntimeStats();
  }

  async cancelJob(jobId: string): Promise<{ job: VideoJob | null; canceled: boolean }> {
    return this.video.cancelJob(jobId);
  }
}
