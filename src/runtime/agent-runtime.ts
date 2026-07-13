import type { MediaInspector, PlaybackTriageService, StreamerCloneInput, StreamerCloneResult, StreamerOriginSummary } from "@gugaio/vhs";
import type { EdgeRuntime } from "../edge/runtime.js";
import type { JobService } from "../jobs/service.js";
import type { ImageGeneratorService } from "../media/image-generator.js";
import type { ProviderBackedMediaGenerationService } from "../media/generation.js";
import type { MemoryService } from "../memory/service.js";
import type { PlannerService } from "../planner/service.js";
import type { ResearchService } from "../research/service.js";
import type { BrowserRuntime } from "./browser/index.js";
import type { McpRuntime } from "../tools/mcp/mcp-bridge-service.js";
import type { ShellRuntime } from "../tools/system/shell-tool-service.js";
import type { VideoJobs } from "../video/jobs.js";
import type { StreamServeManager } from "../video/serve-manager.js";
import type { HlsStreamMonitorService } from "../vhs/watch-registry.js";
import type { WorkspaceInspector } from "../workspace/inspector.js";

export type StreamerRuntime = {
  listOrigins(): Promise<StreamerOriginSummary[]>;
  cloneHls(input: StreamerCloneInput): Promise<StreamerCloneResult>;
  cloneDash(input: StreamerCloneInput): Promise<StreamerCloneResult>;
};

export type AgentRuntime = {
  jobs: JobService;
  videoJobs: VideoJobs;
  shell: ShellRuntime;
  mcp: McpRuntime;
  edge: EdgeRuntime;
  videoInspect: Pick<MediaInspector, "inspectHls" | "probe">;
  memory: MemoryService;
  workspace: WorkspaceInspector;
  research: ResearchService;
  planner: PlannerService;
  imageGenerator: ImageGeneratorService;
  videoGeneration: ProviderBackedMediaGenerationService;
  playbackTriage: PlaybackTriageService;
  streamMonitor: HlsStreamMonitorService;
  browser: BrowserRuntime;
  streamer: StreamerRuntime;
  serveManager: StreamServeManager;
};
