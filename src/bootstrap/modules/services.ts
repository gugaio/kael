import path from "node:path";
import type { KaelConfig } from "../../config.js";
import type { FfmpegJobs } from "../../ffmpeg/jobs.js";
import { createFfmpegPlannerHandlers } from "../../ffmpeg/planner-handlers.js";
import { resolveKaelHome } from "../../global-config.js";
import { MemoryService } from "../../memory/service.js";
import { LlmPlanGenerator } from "../../planner/llm-generator.js";
import { PlannerService } from "../../planner/service.js";
import { DisabledSearchProvider, TavilySearchProvider } from "../../research/provider.js";
import { ResearchService } from "../../research/service.js";
import { SkillService } from "../../skills/service.js";
import { WorkspaceInspector } from "../../workspace/inspector.js";

export type ServicesModule = {
  memory: MemoryService;
  workspace: WorkspaceInspector;
  research: ResearchService;
  planner: PlannerService;
  skills: SkillService;
};

async function bootstrapMemoryService(config: KaelConfig): Promise<MemoryService> {
  const memory = new MemoryService({
    workspaceRoot: config.shell.workspaceRoot,
    storageRoot: path.join(resolveKaelHome(), "data", "memory"),
    defaultMaxResults: 6,
    maxSnippetChars: 1200,
  });
  await memory.init();
  return memory;
}

function bootstrapWorkspaceService(config: KaelConfig): WorkspaceInspector {
  return new WorkspaceInspector({
    workspaceRoot: config.shell.workspaceRoot,
    maxFileChars: 100_000,
    maxSearchResults: 12,
  });
}

function bootstrapResearchService(config: KaelConfig): ResearchService {
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

async function bootstrapPlannerService(config: KaelConfig, deps: { ffmpeg: FfmpegJobs }): Promise<PlannerService> {
  const llmPlanner = new LlmPlanGenerator(config.pi);
  const planner = new PlannerService(config.dataDir, {
    generateDrafts: async ({ objective, maxSteps }) => llmPlanner.generate({ objective, maxSteps }),
  });
  await planner.init();

  const ffmpegHandlers = createFfmpegPlannerHandlers(deps.ffmpeg);
  for (const [kind, handler] of Object.entries(ffmpegHandlers)) {
    planner.registerActionHandler(kind, handler);
  }

  return planner;
}

export async function bootstrapServicesModule(
  config: KaelConfig,
  deps: { ffmpeg: FfmpegJobs },
): Promise<ServicesModule> {
  const memory = await bootstrapMemoryService(config);
  const planner = await bootstrapPlannerService(config, deps);

  return {
    memory,
    workspace: bootstrapWorkspaceService(config),
    research: bootstrapResearchService(config),
    planner,
    skills: new SkillService(config.shell.workspaceRoot),
  };
}
