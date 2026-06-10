import type { VideoInspectToolService } from "./inspect-service.js";
import { analyzeOrigin } from "./streamer/analysis.js";
import { cloneDash } from "./streamer/clone-dash.js";
import { cloneHls } from "./streamer/clone-hls.js";
import { mutateOrigin } from "./streamer/mutation.js";
import { StreamerOriginStore } from "./streamer/origin-store.js";
import { serveLiveOrigin, serveOrigin } from "./streamer/origin-server.js";
import { probeOrigin } from "./streamer/probe.js";
import { SegmentDownloader } from "./streamer/segment-downloader.js";
import type {
  StreamerAnalyzeOptions,
  StreamerCloneInput,
  StreamerCloneResult,
  StreamerLiveServeHandle,
  StreamerLiveServeOptions,
  StreamerMutateInput,
  StreamerMutateResult,
  StreamerOriginAnalysisReport,
  StreamerOriginProbeReport,
  StreamerOriginSummary,
  StreamerProbeOptions,
  StreamerRemoveResult,
  StreamerServeHandle,
  StreamerServeOptions,
} from "./types.js";

type StreamerInspectService = Pick<VideoInspectToolService, "inspectHls"> &
  Partial<Pick<VideoInspectToolService, "inspectDash">> &
  Partial<Pick<VideoInspectToolService, "probe">>;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class StreamerService {
  private readonly originStore: StreamerOriginStore;
  private readonly downloader: SegmentDownloader;

  constructor(
    private readonly inspect: StreamerInspectService,
    private readonly rootDir: string,
    fetchImpl: FetchLike = fetch,
  ) {
    this.originStore = new StreamerOriginStore(rootDir);
    this.downloader = new SegmentDownloader(fetchImpl);
  }

  async init(): Promise<void> {
    await this.originStore.init();
  }

  async listOrigins(): Promise<StreamerOriginSummary[]> {
    return this.originStore.list();
  }

  async inspectOrigin(originId: string): Promise<StreamerCloneResult> {
    return this.originStore.load(originId);
  }

  async mutateOrigin(input: StreamerMutateInput): Promise<StreamerMutateResult> {
    return mutateOrigin(this.originStore, input);
  }

  async probeOrigin(
    originId: string,
    options: StreamerProbeOptions = {},
  ): Promise<StreamerOriginProbeReport> {
    return probeOrigin(this.originStore, this.inspect, originId, options);
  }

  async analyzeOrigin(
    originId: string,
    options: StreamerAnalyzeOptions = {},
  ): Promise<StreamerOriginAnalysisReport> {
    return analyzeOrigin(this.originStore, this.inspect, originId, options);
  }

  async removeOrigin(originId: string): Promise<StreamerRemoveResult> {
    return this.originStore.remove(originId);
  }

  async cloneHls(input: StreamerCloneInput): Promise<StreamerCloneResult> {
    return cloneHls({
      inspect: this.inspect,
      store: this.originStore,
      downloader: this.downloader,
      rootDir: this.rootDir,
      input,
    });
  }

  async cloneDash(input: StreamerCloneInput): Promise<StreamerCloneResult> {
    return cloneDash({
      inspect: this.inspect,
      store: this.originStore,
      downloader: this.downloader,
      rootDir: this.rootDir,
      input,
    });
  }

  async serveOrigin(
    originId: string,
    options: StreamerServeOptions = {},
  ): Promise<StreamerServeHandle> {
    return serveOrigin(this.originStore, originId, options);
  }

  async serveLiveOrigin(
    originId: string,
    options: StreamerLiveServeOptions = {},
  ): Promise<StreamerLiveServeHandle> {
    return serveLiveOrigin(this.originStore, originId, options);
  }
}
