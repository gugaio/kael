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
import { LlmPlanGenerator } from "./planner/llm-generator.js";
import { PlannerService } from "./planner/service.js";
import { DisabledSearchProvider, TavilySearchProvider } from "./research/provider.js";
import { ResearchService } from "./research/service.js";
import { SessionStore } from "./session/store.js";
import { ChatService } from "./chat/service.js";
import { TurnOrchestrator } from "./chat/turn-orchestrator.js";
import { WorkspaceInspector } from "./workspace/inspector.js";
import { LocalProcessRunner } from "./tools/system/process-runner.js";
import { ShellToolService } from "./tools/system/shell-tool-service.js";
import { VideoJobService } from "./tools/video/video-job-service.js";

export type KaelApp = {
  config: KaelConfig;
  sessions: SessionStore;
  jobs: JobManager;
  memory: MemoryService;
  planner: PlannerService;
  research: ResearchService;
  chat: ChatService;
  automation: AutomationService;
  shell: ShellToolService;
};

export async function createKaelApp(): Promise<KaelApp> {
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
  const jobs = new JobManager(jobStore, video);
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
  const memory = new MemoryService({
    workspaceRoot: config.shell.workspaceRoot,
    defaultMaxResults: 6,
    maxSnippetChars: 1200,
  });
  await memory.init();
  const workspace = new WorkspaceInspector({
    workspaceRoot: config.shell.workspaceRoot,
    maxFileChars: 100_000,
    maxSearchResults: 12,
  });
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
  const chat = new ChatService(sessions, jobs, shell, memory, workspace, research, planner, orchestrator);
  const heartbeat = new HeartbeatRunner(jobs, sessions);
  const scheduler = new PersistentScheduler(
    path.join(config.dataDir, "automation", "scheduler-jobs.json"),
    config.automation.schedulerTickMs,
    async ({ job }) => {
      if (job.type === "heartbeat") {
        await heartbeat.runOnce();
        return;
      }
      if (job.type === "planner_reconcile") {
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
      }
    },
  );
  await scheduler.init();
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
  scheduler.start();
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
  };
}
