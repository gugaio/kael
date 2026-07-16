import type {
  MediaInspector,
  PlaybackTriageService,
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
} from "@gugaio/vhs";
import type { EdgeRuntime } from "../edge/runtime.js";
import type { JobService } from "../jobs/service.js";
import type { ImageGeneratorService } from "../media/image-generator.js";
import type { ProviderBackedMediaGenerationService } from "../media/generation.js";
import type { MemoryService } from "../memory/service.js";
import type { PlannerService } from "../planner/service.js";
import type { ResearchService } from "../research/service.js";
import type { SessionStore } from "../session/store.js";
import type { SkillService } from "../skills/service.js";
import type { BrowserRuntime } from "../runtime/browser/index.js";
import type { TurnOrchestrator } from "../chat/turn-orchestrator.js";
import type { MediaUnderstandingService } from "../media/service.js";
import type { McpRuntime } from "../tools/mcp/mcp-bridge-service.js";
import type { ShellRuntime } from "../shell/service.js";
import type { FfmpegJobs } from "../ffmpeg/jobs.js";
import type { StreamServeManager } from "../video/serve-manager.js";
import type { StreamWatchParams, StreamWatchStatus } from "../vhs/types.js";
import type { WorkspaceInspector } from "../workspace/inspector.js";

export type StreamerRuntime = {
  listOrigins(): Promise<StreamerOriginSummary[]>;
  inspectOrigin(originId: string): Promise<StreamerCloneResult>;
  probeOrigin(originId: string, options?: StreamerProbeOptions): Promise<StreamerOriginProbeReport>;
  analyzeOrigin(originId: string, options?: StreamerAnalyzeOptions): Promise<StreamerOriginAnalysisReport>;
  mutateOrigin(input: StreamerMutateInput): Promise<StreamerMutateResult>;
  removeOrigin(originId: string): Promise<StreamerRemoveResult>;
  cloneHls(input: StreamerCloneInput): Promise<StreamerCloneResult>;
  cloneDash(input: StreamerCloneInput): Promise<StreamerCloneResult>;
  serveOrigin(originId: string, options?: StreamerServeOptions): Promise<StreamerServeHandle>;
  serveLiveOrigin(originId: string, options?: StreamerLiveServeOptions): Promise<StreamerLiveServeHandle>;
};

export type StreamMonitorRuntime = {
  startWatch(params: StreamWatchParams): string;
  stopWatch(id: string): boolean;
  getStatus(id: string): StreamWatchStatus | null;
  listWatches(): StreamWatchStatus[];
  stopAll(): void;
};

export type AgentContext = {
  core: {
    sessions: SessionStore;
    orchestrator: TurnOrchestrator;
  };
  runtimes: {
    shell: ShellRuntime;
    mcp: McpRuntime;
    edge: EdgeRuntime;
    browser: BrowserRuntime;
  };
  services: {
    memory: MemoryService;
    workspace: WorkspaceInspector;
    research: ResearchService;
    planner: PlannerService;
    skills: SkillService;
    media: MediaUnderstandingService;
  };
  video: {
    jobs: JobService;
    ffmpeg: FfmpegJobs;
    inspect: Pick<MediaInspector, "inspectHls" | "probe">;
    playbackTriage: PlaybackTriageService;
    streamMonitor: StreamMonitorRuntime;
    streamer: StreamerRuntime;
    serveManager: StreamServeManager;
  };
  generation: {
    image: ImageGeneratorService;
    video: ProviderBackedMediaGenerationService;
  };
};
