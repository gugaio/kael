import "dotenv/config";
import path from "node:path";
import { HeartbeatRunner } from "./automation/heartbeat-runner.js";
import { PersistentScheduler } from "./automation/scheduler/persistent-scheduler.js";
import { AutomationService } from "./automation/service.js";
import { loadConfig, type KaelConfig } from "./config.js";
import {
  createBrowserRuntime,
  createMediaRuntime,
  createMcpRuntime,
  createMemoryRuntime,
  createPlannerRuntime,
  createProjectContextRuntime,
  createResearchRuntime,
  createShellRuntime,
  createVideoRuntime,
  createWorkspaceRuntime,
} from "./bootstrap/runtime.js";
import { createEngine } from "./agents/factory.js";
import { JobManager } from "./jobs/manager.js";
import { JobStore } from "./jobs/store.js";
import { MemoryService } from "./memory/service.js";
import { ProjectContextService } from "./projects/service.js";
import { PlannerService } from "./planner/service.js";
import { ResearchService } from "./research/service.js";
import { SessionStore } from "./session/store.js";
import { EmailIngestService } from "./email/ingest-service.js";
import type { EmailIngestRuntimeTelemetry } from "./email/ingest-service.js";
import { GmailPop3Provider } from "./email/gmail-pop3-provider.js";
import { GmailSmtpSender } from "./email/gmail-smtp-sender.js";
import { FileEmailIngestDedupeStore } from "./email/ingest-dedupe-store.js";
import { ChatService } from "./chat/service.js";
import { createChatTooling } from "./chat/tooling-factory.js";
import { TurnOrchestrator } from "./chat/turn-orchestrator.js";
import type { ShellRuntime } from "./tools/system/shell-tool-service.js";
import { PlaybackTriageService } from "./capabilities/video/index.js";
import type { StreamWatchParams, StreamWatchStatus } from "./capabilities/video/index.js";
import { SkillService } from "./skills/service.js";
import type { McpRuntime } from "./tools/mcp/mcp-bridge-service.js";
import { EdgeRuntime } from "./edge/runtime.js";
import type {
  HlsManifestAuditInput,
  HlsManifestAuditReport,
  HlsManifestDiffInput,
  HlsManifestDiffReport,
  StreamerCloneInput,
  StreamerCloneResult,
  StreamerAnalyzeOptions,
  StreamerLiveServeHandle,
  StreamerLiveServeOptions,
  StreamerOriginAnalysisReport,
  StreamerOriginProbeReport,
  StreamerOriginSummary,
  StreamerProbeOptions,
  StreamerRemoveResult,
  StreamerServeHandle,
  StreamerServeOptions,
} from "./capabilities/video/index.js";

export type KaelApp = {
  config: KaelConfig;
  sessions: SessionStore;
  jobs: JobManager;
  memory: MemoryService;
  projects: ProjectContextService;
  planner: PlannerService;
  research: ResearchService;
  chat: ChatService;
  automation: AutomationService;
  shell: ShellRuntime;
  mcp: McpRuntime;
  edge: EdgeRuntime;
  manifestAudit: {
    auditHlsManifest(input: HlsManifestAuditInput): Promise<HlsManifestAuditReport>;
  };
  manifestDiff: {
    diffHlsManifests(input: HlsManifestDiffInput): Promise<HlsManifestDiffReport>;
  };
  streamMonitor: {
    startWatch(params: StreamWatchParams): string;
    stopWatch(id: string): boolean;
    getStatus(id: string): StreamWatchStatus | null;
    listWatches(): StreamWatchStatus[];
    stopAll(): void;
  };
  streamer: {
    listOrigins(): Promise<StreamerOriginSummary[]>;
    inspectOrigin(originId: string): Promise<StreamerCloneResult>;
    probeOrigin(originId: string, options?: StreamerProbeOptions): Promise<StreamerOriginProbeReport>;
    analyzeOrigin(originId: string, options?: StreamerAnalyzeOptions): Promise<StreamerOriginAnalysisReport>;
    removeOrigin(originId: string): Promise<StreamerRemoveResult>;
    cloneHls(input: StreamerCloneInput): Promise<StreamerCloneResult>;
    serveOrigin(originId: string, options?: StreamerServeOptions): Promise<StreamerServeHandle>;
    serveLiveOrigin(originId: string, options?: StreamerLiveServeOptions): Promise<StreamerLiveServeHandle>;
  };
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

  const { jobs, videoInspect, manifestAudit, manifestDiff, videoArtifacts, streamMonitor, streamer } =
    await createVideoRuntime(config, jobStore);
  const shell = await createShellRuntime(config);
  const mcp = await createMcpRuntime(config);
  const edge = new EdgeRuntime();
  const memory = await createMemoryRuntime(config);
  const projects = createProjectContextRuntime(config);
  const workspace = createWorkspaceRuntime(config);
  const browserRuntime = createBrowserRuntime(config);
  const research = createResearchRuntime(config);
  const planner = await createPlannerRuntime(config);
  const engine = createEngine(config);
  const orchestrator = new TurnOrchestrator(sessions, engine, {
    maxContextMessages: config.context.maxMessages,
    maxContextChars: config.context.maxChars,
  });
  const { mediaUnderstanding, imageGenerator, videoGeneration } = createMediaRuntime(config, videoArtifacts);
  const tooling = createChatTooling({
    jobManager: jobs,
    shellRuntime: shell,
    mcpRuntime: mcp,
    edgeRuntime: edge,
    videoInspect,
    memory,
    projects,
    workspace,
    research,
    planner,
    playbackTriage: new PlaybackTriageService(),
    manifestAudit,
    manifestDiff,
    streamMonitor,
    browserRuntime,
    imageGenerator,
    videoGeneration,
  });
  const chat = new ChatService(
    sessions,
    shell,
    orchestrator,
    mediaUnderstanding,
    memory,
    tooling,
    projects,
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
    projects,
    planner,
    research,
    chat,
    automation,
    shell,
    mcp,
    edge,
    manifestAudit,
    manifestDiff,
    streamMonitor,
    streamer,
    ...(emailIngest ? { emailIngest } : {}),
  };
}
