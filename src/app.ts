import "dotenv/config";
import path from "node:path";
import { HeartbeatRunner } from "./automation/heartbeat-runner.js";
import { PersistentScheduler } from "./automation/persistent-scheduler.js";
import { AutomationService } from "./automation/service.js";
import { loadConfig, type KaelConfig } from "./config.js";
import { createEngine } from "./engine/factory.js";
import { resolveKaelHome } from "./global-config.js";
import { JobManager } from "./jobs/manager.js";
import { JobStore } from "./jobs/store.js";
import { MemoryService } from "./memory/service.js";
import { HybridMemoryRetriever } from "./memory/retriever-hybrid.js";
import { LlmPlanGenerator } from "./planner/llm-generator.js";
import { PlannerService } from "./planner/service.js";
import { DisabledSearchProvider, TavilySearchProvider } from "./research/provider.js";
import { ResearchService } from "./research/service.js";
import { SessionStore } from "./session/store.js";
import { EmailIngestService } from "./email/ingest-service.js";
import type { EmailIngestRuntimeTelemetry } from "./email/ingest-service.js";
import { GmailPop3Provider } from "./email/gmail-pop3-provider.js";
import { GmailSmtpSender } from "./email/gmail-smtp-sender.js";
import { FileEmailIngestDedupeStore } from "./email/ingest-dedupe-store.js";
import { ChatService } from "./chat/service.js";
import { createChatOnlyTooling, createChatTooling } from "./chat/tooling-factory.js";
import { TurnOrchestrator } from "./chat/turn-orchestrator.js";
import { WorkspaceInspector } from "./workspace/inspector.js";
import { LocalProcessRunner } from "./tools/system/process-runner.js";
import { ShellToolService, type ShellRuntime } from "./tools/system/shell-tool-service.js";
import {
  PlaybackTriageService,
  ProviderBackedVideoGenerationService,
  VideoArtifactsService,
  VideoCapability,
  VideoInspectToolService,
  VideoJobService,
} from "./capabilities/video/index.js";
import { NoopMediaUnderstandingService, OpenAiMediaUnderstandingService } from "./media/service.js";
import { NoopImageGeneratorService, OpenAiImageGeneratorService } from "./media/image-generator.js";
import { BrowserCapability, BrowserToolService } from "./capabilities/browser/index.js";
import { SkillService } from "./skills/service.js";
import { McpBridgeService, type McpRuntime } from "./tools/mcp/mcp-bridge-service.js";
import { EdgeRuntime } from "./edge/runtime.js";

export type KaelApp = {
  config: KaelConfig;
  sessions: SessionStore;
  jobs: JobManager;
  memory: MemoryService;
  planner: PlannerService;
  research: ResearchService;
  chat: ChatService;
  automation: AutomationService;
  shell: ShellRuntime;
  mcp: McpRuntime;
  edge: EdgeRuntime;
  emailIngest?: {
    getRuntimeTelemetrySnapshot(): EmailIngestRuntimeTelemetry;
  };
};

export type CreateKaelAppOptions = {
  startAutomation?: boolean;
  enableEmailPolling?: boolean;
};

export async function createKaelApp(options: CreateKaelAppOptions = {}): Promise<KaelApp> {
  const startAutomation = options.startAutomation ?? true;
  const enableEmailPolling = options.enableEmailPolling ?? startAutomation;
  const config = await loadConfig();
  const sessions = new SessionStore(config.dataDir);
  const jobStore = new JobStore(config.dataDir);

  await sessions.init();
  await jobStore.init();

  const runner = new LocalProcessRunner();
  const video = new VideoJobService(jobStore, runner, {
    safePathsEnabled: config.execution.safePathsEnabled,
    allowedPaths: config.execution.allowedPaths,
    maxJobArgs: config.execution.maxJobArgs,
    maxConcurrentJobs: config.execution.maxConcurrentJobs,
    jobTimeoutMs: config.execution.jobTimeoutMs,
    killGraceMs: config.execution.killGraceMs,
  });
  const jobs = new JobManager(jobStore, [new VideoCapability(video)]);
  const videoInspect = new VideoInspectToolService();
  const videoArtifacts = new VideoArtifactsService(path.join(config.dataDir, "video", "artifacts"));
  await videoArtifacts.init();
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
  const edge = new EdgeRuntime();
  const memory = new MemoryService({
    workspaceRoot: config.shell.workspaceRoot,
    storageRoot: path.join(resolveKaelHome(), "data", "memory"),
    defaultMaxResults: 6,
    maxSnippetChars: 1200,
    retriever: new HybridMemoryRetriever(),
  });
  await memory.init();
  const workspace = new WorkspaceInspector({
    workspaceRoot: config.shell.workspaceRoot,
    maxFileChars: 100_000,
    maxSearchResults: 12,
  });
  const browserRuntime = new BrowserToolService({
    enabled: config.browser.enabled,
    headless: config.browser.headless,
    defaultTimeoutMs: config.browser.defaultTimeoutMs,
    actionTimeoutMs: config.browser.actionTimeoutMs,
    maxScreenshotsPerTurn: config.browser.maxScreenshotsPerTurn,
    sessionTtlMs: config.browser.sessionTtlMs,
    maxSessions: config.browser.maxSessions,
    artifactDir: config.browser.artifactDir,
  });
  const browser = new BrowserCapability(browserRuntime);
  const searchProvider = config.research.enabled && config.research.apiKey
    ? new TavilySearchProvider(config.research.apiKey)
    : new DisabledSearchProvider();
  const research = new ResearchService(searchProvider, {
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
  const llmPlanner = new LlmPlanGenerator(config.pi);
  const planner = new PlannerService(config.dataDir, {
    generateDrafts: async ({ objective, maxSteps }) => llmPlanner.generate({ objective, maxSteps }),
  });
  await planner.init();
  const engine = createEngine(config);
  const orchestrator = new TurnOrchestrator(sessions, engine, {
    maxContextMessages: config.context.maxMessages,
    maxContextChars: config.context.maxChars,
  });
  const tooling = createChatTooling({
    jobs,
    shell,
    mcp,
    edge,
    videoInspect,
    memory,
    workspace,
    research,
    planner,
    playbackTriage: new PlaybackTriageService(),
    browser,
    imageGenerator:
      config.media.enabled && !!config.media.apiKey
        ? new OpenAiImageGeneratorService({
            apiKey: config.media.apiKey,
            baseUrl: config.media.baseUrl,
            timeoutMs: config.media.imageGenerationTimeoutMs,
            model: process.env.KAEL_IMAGE_GENERATION_MODEL?.trim() || "gpt-image-1",
          })
        : new NoopImageGeneratorService(),
    videoGeneration: new ProviderBackedVideoGenerationService(
      config.media.enabled && !!config.media.apiKey
        ? new OpenAiImageGeneratorService({
            apiKey: config.media.apiKey,
            baseUrl: config.media.baseUrl,
            timeoutMs: config.media.imageGenerationTimeoutMs,
            model: process.env.KAEL_IMAGE_GENERATION_MODEL?.trim() || "gpt-image-1",
          })
        : new NoopImageGeneratorService(),
      videoArtifacts,
      {
        imageProvider: process.env.KAEL_IMAGE_GENERATION_MODEL?.trim() || "gpt-image-1",
        videoProvider: process.env.KAEL_VIDEO_GENERATION_PROVIDER?.trim() || undefined,
      },
    ),
  });
  const chat = new ChatService(
    sessions,
    shell,
    orchestrator,
    config.media.enabled
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
      : new NoopMediaUnderstandingService(),
    memory,
    tooling,
    createChatOnlyTooling(tooling),
    new SkillService(config.shell.workspaceRoot),
  );
  const heartbeat = new HeartbeatRunner(jobs, sessions);
  let emailIngest: EmailIngestService | null = null;
  if (enableEmailPolling && config.email.enabled && config.email.provider === "gmail_pop3") {
    const provider = new GmailPop3Provider({
      address: config.email.gmail.address,
      appPassword: config.email.gmail.appPassword,
      host: config.email.gmail.host,
      port: config.email.gmail.port,
      timeoutMs: config.email.gmail.timeoutMs,
      topLines: config.email.gmail.topLines,
      maxMessagesPerPoll: config.email.gmail.maxMessagesPerPoll,
      statePath: path.join(config.dataDir, "email", "gmail-pop3-state.json"),
    });
    const sender = config.email.autoReplyEnabled
      ? new GmailSmtpSender({
          address: config.email.gmail.address,
          appPassword: config.email.gmail.appPassword,
          host: config.email.gmail.smtpHost,
          port: config.email.gmail.smtpPort,
          timeoutMs: config.email.gmail.smtpTimeoutMs,
        })
      : undefined;
    emailIngest = new EmailIngestService(
      provider,
      chat,
      sender,
      new FileEmailIngestDedupeStore({
        rootDir: path.join(config.dataDir, "email", "ingest-dedupe"),
      }),
      config.email.gmail.address,
    );
    await emailIngest.init();
  }
  const scheduler = new PersistentScheduler(
    path.join(config.dataDir, "automation", "scheduler-jobs.json"),
    config.automation.schedulerTickMs,
    async ({ job }) => {
      if (job.type === "heartbeat") {
        await heartbeat.runOnce();
        return;
      }
      if (job.type === "planner_reconcile") {
        const hasActivePlan = planner.list({ status: "active", limit: 1 }).length > 0;
        if (!hasActivePlan) {
          return;
        }
        await planner.reconcile({
          limit: 200,
          runtime: {
            getJob: async (jobId: string) => {
              const found = jobs.getJob(jobId);
              if (!found) {
                return null;
              }
              return {
                status: found.status,
                error: found.error,
              };
            },
            pollExec: async (sessionId: string) => {
              const result = await shell.process({
                sessionKey: "planner.reconcile",
                action: "poll",
                sessionId,
              });
              if (!result.ok || !result.session) {
                return null;
              }
              return {
                status: result.session.status,
                message: result.message,
              };
            },
          },
        });
        return;
      }
      if (job.type === "email_poll") {
        if (!emailIngest) {
          return;
        }
        const result = await emailIngest.pollNow();
        if (result.skipped) {
          return;
        }
      }
    },
  );
  await scheduler.init();
  if (startAutomation) {
    await scheduler.upsertIntervalJob({
      id: "heartbeat.main",
      type: "heartbeat",
      intervalMs: config.automation.heartbeatIntervalMs,
      enabled: config.automation.heartbeatEnabled,
    });
    await scheduler.upsertIntervalJob({
      id: "planner.reconcile",
      type: "planner_reconcile",
      intervalMs: config.automation.plannerReconcileIntervalMs,
      enabled: config.automation.plannerReconcileEnabled,
    });
    await scheduler.upsertIntervalJob({
      id: "email.poll",
      type: "email_poll",
      intervalMs: config.email.pollIntervalMs,
      enabled: config.email.enabled && enableEmailPolling,
    });
    scheduler.start();
  }
  const automation = new AutomationService(scheduler);

  return {
    config,
    sessions,
    jobs,
    memory,
    planner,
    research,
    chat,
    automation,
    shell,
    mcp,
    edge,
    ...(emailIngest ? { emailIngest } : {}),
  };
}
