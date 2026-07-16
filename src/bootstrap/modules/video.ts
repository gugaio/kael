import path from "node:path";
import { createVhs, type Vhs } from "@gugaio/vhs";
import type { StreamerRuntime, StreamMonitorRuntime } from "../../agents/context.js";
import type { KaelConfig } from "../../config.js";
import { createFfmpegJobs, type FfmpegJobs } from "../../ffmpeg/jobs.js";
import type { JobService } from "../../jobs/service.js";
import { MediaArtifactsService } from "../../media/artifacts.js";
import { HlsStreamMonitorService } from "../../vhs/watch-registry.js";
import { StreamServeManager } from "../../video/serve-manager.js";

export type VideoModule = {
  ffmpeg: FfmpegJobs;
  videoInspect: Vhs["inspect"];
  mediaArtifacts: MediaArtifactsService;
  streamMonitor: StreamMonitorRuntime;
  streamer: StreamerRuntime;
  playback: Vhs["playback"];
  serveManager: StreamServeManager;
};

export async function bootstrapVideoModule(
  config: KaelConfig,
  deps: { jobs: JobService },
): Promise<VideoModule> {
  const ffmpeg = createFfmpegJobs({
    jobs: deps.jobs,
    options: {
      safePathsEnabled: config.execution.safePathsEnabled,
      allowedPaths: config.execution.allowedPaths,
      maxJobArgs: config.execution.maxJobArgs,
    },
  });
  const vhs = await createVhs({ dataDir: path.join(config.dataDir, "streamer") });
  const mediaArtifacts = new MediaArtifactsService(path.join(config.dataDir, "media", "artifacts"));
  await mediaArtifacts.init();
  const streamMonitor = new HlsStreamMonitorService(vhs.watch);
  const streamer: StreamerRuntime = {
    listOrigins: () => vhs.stream.listOrigins(),
    inspectOrigin: (originId) => vhs.stream.loadOrigin(originId),
    probeOrigin: (originId, options) => vhs.stream.probeOrigin(originId, options),
    analyzeOrigin: (originId, options) => vhs.stream.analyzeOrigin(originId, options),
    mutateOrigin: (input) => vhs.stream.mutateOrigin(input),
    removeOrigin: (originId) => vhs.stream.removeOrigin(originId),
    cloneHls: (input) => vhs.stream.cloneHls(input),
    cloneDash: (input) => vhs.stream.cloneDash(input),
    serveOrigin: (originId, options) => vhs.stream.serveOrigin(originId, options),
    serveLiveOrigin: (originId, options) => vhs.stream.serveLiveOrigin(originId, options),
  };
  const serveManager = new StreamServeManager(
    (originId, opts) => streamer.serveOrigin(originId, opts),
    (originId, opts) => streamer.serveLiveOrigin(originId, opts),
  );

  return {
    ffmpeg,
    videoInspect: vhs.inspect,
    mediaArtifacts,
    streamMonitor,
    streamer,
    playback: vhs.playback,
    serveManager,
  };
}
