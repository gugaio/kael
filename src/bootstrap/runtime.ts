import path from "node:path";
import type { KaelConfig } from "../config.js";
import { resolveKaelHome } from "../global-config.js";
import type { JobStore } from "../jobs/store.js";
import { JobService } from "../jobs/service.js";
import { LocalProcessSupervisor } from "../process/supervisor.js";
import { LocalProcessRunner } from "../tools/system/process-runner.js";
import { ShellToolService } from "../tools/system/shell-tool-service.js";
import { McpBridgeService } from "../tools/mcp/mcp-bridge-service.js";
import { createVhs, type Vhs } from "@gugaio/vhs";
import { createVideoJobs, type VideoJobs } from "../video/jobs.js";
import { HlsStreamMonitorService } from "../vhs/watch-registry.js";
import { MediaArtifactsService } from "../media/artifacts.js";
import { ProviderBackedMediaGenerationService } from "../media/generation.js";
import type {
  HlsManifestAuditInput,
  HlsManifestAuditReport,
  HlsManifestDiffInput,
  HlsManifestDiffReport,
} from "../vhs/types.js";
import { MemoryService } from "../memory/service.js";
import { ProjectContextService } from "../projects/service.js";
import { WorkspaceInspector } from "../workspace/inspector.js";
import { BrowserRuntimeService, type BrowserRuntime } from "../runtime/browser/index.js";
import { DisabledSearchProvider, TavilySearchProvider } from "../research/provider.js";
import { ResearchService } from "../research/service.js";
import { LlmPlanGenerator } from "../planner/llm-generator.js";
import { PlannerService } from "../planner/service.js";
import {
  NoopMediaUnderstandingService,
  OpenAiMediaUnderstandingService,
  type MediaUnderstandingService,
} from "../media/service.js";
import {
  NoopImageGeneratorService,
  OpenAiImageGeneratorService,
  type ImageGeneratorService,
} from "../media/image-generator.js";

export async function createVideoRuntime(config: KaelConfig, jobStore: JobStore): Promise<{
  jobs: JobService;
  videoJobs: VideoJobs;
  videoInspect: Vhs["inspect"];
  manifestAudit: { auditHlsManifest(input: HlsManifestAuditInput): Promise<HlsManifestAuditReport> };
  manifestDiff: { diffHlsManifests(input: HlsManifestDiffInput): Promise<HlsManifestDiffReport> };
  mediaArtifacts: MediaArtifactsService;
  streamMonitor: HlsStreamMonitorService;
  streamer: Vhs["stream"];
  playback: Vhs["playback"];
}> {
  const runner = new LocalProcessRunner();
  const supervisor = new LocalProcessSupervisor(runner);
  const jobs = new JobService(jobStore, supervisor, {
    maxConcurrentJobs: config.execution.maxConcurrentJobs,
    jobTimeoutMs: config.execution.jobTimeoutMs,
    killGraceMs: config.execution.killGraceMs,
  });
  const videoJobs = createVideoJobs({
    jobs,
    options: {
      safePathsEnabled: config.execution.safePathsEnabled,
      allowedPaths: config.execution.allowedPaths,
      maxJobArgs: config.execution.maxJobArgs,
    },
  });
  const vhs = await createVhs({ dataDir: path.join(config.dataDir, "streamer") });
  const videoInspect = vhs.inspect;
  const manifestAudit = {
    auditHlsManifest: (input: HlsManifestAuditInput) => vhs.manifest.audit.audit(input),
  };
  const manifestDiff = {
    diffHlsManifests: (input: HlsManifestDiffInput) => vhs.manifest.diff.diff(input),
  };
  const mediaArtifacts = new MediaArtifactsService(path.join(config.dataDir, "media", "artifacts"));
  await mediaArtifacts.init();
  const streamMonitor = new HlsStreamMonitorService(vhs.watch);
  const streamer = vhs.stream;
  return {
    jobs,
    videoJobs,
    videoInspect,
    manifestAudit,
    manifestDiff,
    mediaArtifacts,
    streamMonitor,
    streamer,
    playback: vhs.playback,
  };
}

export async function createShellRuntime(config: KaelConfig): Promise<ShellToolService> {
  const shell = new ShellToolService({
    workspaceRoot: config.shell.workspaceRoot,
    defaultTimeoutMs: config.shell.defaultTimeoutMs,
    noOutputTimeoutMs: config.shell.noOutputTimeoutMs,
    maxTimeoutMs: config.shell.maxTimeoutMs,
    maxOutputChars: config.shell.maxOutputChars,
    approvalWaitMs: config.shell.approvalWaitMs,
    security: config.shell.security,
    ask: config.shell.ask,
    allowlist: config.shell.allowlist,
    approvalsPath: path.join(resolveKaelHome(), "exec-approvals.json"),
  });
  await shell.init();
  return shell;
}

export async function createMcpRuntime(config: KaelConfig): Promise<McpBridgeService> {
  const mcp = new McpBridgeService({
    enabled: config.mcp.enabled,
    binary: config.mcp.binary,
    configPath: config.mcp.configPath,
    registryPath: path.join(config.dataDir, "mcp", "registry.json"),
    approvalsPath: path.join(config.dataDir, "mcp", "approvals.json"),
    workspaceRoot: config.shell.workspaceRoot,
    defaultTimeoutMs: config.mcp.defaultTimeoutMs,
    maxOutputChars: config.mcp.maxOutputChars,
    allowHttp: config.mcp.allowHttp,
    allowStdio: config.mcp.allowStdio,
  });
  await mcp.init();
  return mcp;
}

export async function createMemoryRuntime(config: KaelConfig): Promise<MemoryService> {
  const memory = new MemoryService({
    workspaceRoot: config.shell.workspaceRoot,
    storageRoot: path.join(resolveKaelHome(), "data", "memory"),
    defaultMaxResults: 6,
    maxSnippetChars: 1200,

  });
  await memory.init();
  return memory;
}

export function createProjectContextRuntime(config: KaelConfig): ProjectContextService {
  return new ProjectContextService(config.shell.workspaceRoot);
}

export function createWorkspaceRuntime(config: KaelConfig): WorkspaceInspector {
  return new WorkspaceInspector({
    workspaceRoot: config.shell.workspaceRoot,
    maxFileChars: 100_000,
    maxSearchResults: 12,
  });
}

export function createBrowserRuntime(config: KaelConfig): BrowserRuntime {
  return new BrowserRuntimeService({
    enabled: config.browser.enabled,
    headless: config.browser.headless,
    defaultTimeoutMs: config.browser.defaultTimeoutMs,
    actionTimeoutMs: config.browser.actionTimeoutMs,
    maxScreenshotsPerTurn: config.browser.maxScreenshotsPerTurn,
    sessionTtlMs: config.browser.sessionTtlMs,
    maxSessions: config.browser.maxSessions,
    artifactDir: config.browser.artifactDir,
  });
}

export function createResearchRuntime(config: KaelConfig): ResearchService {
  const searchProvider = config.research.enabled && config.research.apiKey
    ? new TavilySearchProvider(config.research.apiKey)
    : new DisabledSearchProvider();
  return new ResearchService(searchProvider, {
    enabled: config.research.enabled,
    dataDir: config.dataDir,
    defaultMaxResults: config.research.defaultMaxResults,
    maxResultsLimit: config.research.maxResultsLimit,
    timeoutMs: config.research.timeoutMs,
    fetchMaxChars: config.research.fetchMaxChars,
    fetchCacheTtlMs: config.research.fetchCacheTtlMs,
    fetchMaxRedirects: config.research.fetchMaxRedirects,
    fetchMaxResponseBytes: config.research.fetchMaxResponseBytes,
  });
}

export async function createPlannerRuntime(config: KaelConfig): Promise<PlannerService> {
  const llmPlanner = new LlmPlanGenerator(config.pi);
  const planner = new PlannerService(config.dataDir, {
    generateDrafts: async ({ objective, maxSteps }) => llmPlanner.generate({ objective, maxSteps }),
  });
  await planner.init();
  return planner;
}

function createImageGenerator(config: KaelConfig): ImageGeneratorService {
  if (!config.media.enabled || !config.media.apiKey) {
    return new NoopImageGeneratorService();
  }
  return new OpenAiImageGeneratorService({
    apiKey: config.media.apiKey,
    baseUrl: config.media.baseUrl,
    timeoutMs: config.media.imageGenerationTimeoutMs,
    model: process.env.KAEL_IMAGE_GENERATION_MODEL?.trim() || "gpt-image-1",
  });
}

export function createMediaRuntime(
  config: KaelConfig,
  mediaArtifacts: MediaArtifactsService,
): {
  mediaUnderstanding: MediaUnderstandingService;
  imageGenerator: ImageGeneratorService;
  videoGeneration: ProviderBackedMediaGenerationService;
} {
  const imageGenerator = createImageGenerator(config);
  const mediaUnderstanding = config.media.enabled
    ? new OpenAiMediaUnderstandingService({
        enabled: config.media.enabled,
        apiKey: config.media.apiKey,
        baseUrl: config.media.baseUrl,
        timeoutMs: config.media.timeoutMs,
        maxAttachmentBytes: config.media.maxAttachmentBytes,
        maxTotalBytesPerMessage: config.media.maxTotalBytesPerMessage,
        maxProcessingMsPerMessage: config.media.maxProcessingMsPerMessage,
        maxAttachmentsPerMessage: config.media.maxAttachmentsPerMessage,
        maxAttachmentsBySource: config.media.maxAttachmentsBySource,
        imageModel: config.media.imageModel,
        imagePrompt: config.media.imagePrompt,
        audioModel: config.media.audioModel,
      })
    : new NoopMediaUnderstandingService();

  const videoGeneration = new ProviderBackedMediaGenerationService(
    imageGenerator,
    mediaArtifacts,
    {
      imageProvider: process.env.KAEL_IMAGE_GENERATION_MODEL?.trim() || "gpt-image-1",
      videoProvider: process.env.KAEL_VIDEO_GENERATION_PROVIDER?.trim() || undefined,
    },
  );

  return {
    mediaUnderstanding,
    imageGenerator,
    videoGeneration,
  };
}
