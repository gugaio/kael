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
import { SessionStore } from "./session/store.js";
import { ChatService } from "./services/chat-service.js";
import { TurnOrchestrator } from "./services/turn-orchestrator.js";
import { LocalProcessRunner } from "./tools/system/process-runner.js";
import { ShellToolService } from "./tools/system/shell-tool-service.js";
import { VideoJobService } from "./tools/video/video-job-service.js";

export type KaelApp = {
  config: KaelConfig;
  sessions: SessionStore;
  jobs: JobManager;
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
    maxTimeoutMs: config.shell.maxTimeoutMs,
    maxOutputChars: config.shell.maxOutputChars,
    approvalWaitMs: config.shell.approvalWaitMs,
    security: config.shell.security,
    ask: config.shell.ask,
    allowlist: config.shell.allowlist,
    approvalsPath: path.join(resolveKaelHome(), "exec-approvals.json"),
  });
  await shell.init();
  const engine = createEngine(config);
  const orchestrator = new TurnOrchestrator(sessions, engine, {
    maxContextMessages: config.context.maxMessages,
    maxContextChars: config.context.maxChars,
  });
  const chat = new ChatService(sessions, jobs, shell, orchestrator);
  const heartbeat = new HeartbeatRunner(jobs, sessions);
  const scheduler = new PersistentScheduler(
    path.join(config.dataDir, "automation", "scheduler-jobs.json"),
    config.automation.schedulerTickMs,
    async ({ job }) => {
      if (job.type !== "heartbeat") {
        return;
      }
      await heartbeat.runOnce();
    },
  );
  await scheduler.init();
  await scheduler.upsertIntervalJob({
    id: "heartbeat.main",
    type: "heartbeat",
    intervalMs: config.automation.heartbeatIntervalMs,
    enabled: config.automation.heartbeatEnabled,
  });
  scheduler.start();
  const automation = new AutomationService(scheduler);

  return {
    config,
    sessions,
    jobs,
    chat,
    automation,
    shell,
  };
}
