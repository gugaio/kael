import path from "node:path";
import { HeartbeatRunner } from "../../automation/heartbeat-runner.js";
import { PersistentScheduler } from "../../automation/scheduler/persistent-scheduler.js";
import { AutomationService } from "../../automation/service.js";
import type { ChatService } from "../../chat/service.js";
import type { KaelConfig } from "../../config.js";
import { FileEmailIngestDedupeStore } from "../../email/ingest-dedupe-store.js";
import { EmailIngestService } from "../../email/ingest-service.js";
import type { EmailIngestRuntimeTelemetry } from "../../email/ingest-service.js";
import { GmailPop3Provider } from "../../email/gmail-pop3-provider.js";
import { GmailSmtpSender } from "../../email/gmail-smtp-sender.js";
import type { JobService } from "../../jobs/service.js";
import type { PlannerService } from "../../planner/service.js";
import type { SessionStore } from "../../session/store.js";
import type { ShellRuntime } from "../../tools/system/shell-tool-service.js";

export type AutomationModule = {
  automation: AutomationService;
  emailIngest?: {
    getRuntimeTelemetrySnapshot(): EmailIngestRuntimeTelemetry;
  };
};

async function bootstrapEmailIngest(
  config: KaelConfig,
  deps: { chat: ChatService; enableEmailPolling: boolean },
): Promise<EmailIngestService | null> {
  if (!deps.enableEmailPolling || !config.email.enabled || config.email.provider !== "gmail_pop3") {
    return null;
  }
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
  const emailIngest = new EmailIngestService(
    provider,
    deps.chat,
    sender,
    new FileEmailIngestDedupeStore({
      rootDir: path.join(config.dataDir, "email", "ingest-dedupe"),
    }),
    config.email.gmail.address,
  );
  await emailIngest.init();
  return emailIngest;
}

export async function bootstrapAutomationModule(
  config: KaelConfig,
  deps: {
    startAutomation: boolean;
    enableEmailPolling: boolean;
    jobs: JobService;
    sessions: SessionStore;
    planner: PlannerService;
    shell: ShellRuntime;
    chat: ChatService;
  },
): Promise<AutomationModule> {
  const heartbeat = new HeartbeatRunner(deps.jobs, deps.sessions);
  const emailIngest = await bootstrapEmailIngest(config, {
    chat: deps.chat,
    enableEmailPolling: deps.enableEmailPolling,
  });
  const scheduler = new PersistentScheduler(
    path.join(config.dataDir, "automation", "scheduler-jobs.json"),
    config.automation.schedulerTickMs,
    async ({ job }) => {
      if (job.type === "heartbeat") {
        await heartbeat.runOnce();
        return;
      }
      if (job.type === "planner_reconcile") {
        const hasActivePlan = deps.planner.list({ status: "active", limit: 1 }).length > 0;
        if (!hasActivePlan) {
          return;
        }
        await deps.planner.reconcile({
          limit: 200,
          runtime: {
            getJob: async (jobId: string) => {
              const found = deps.jobs.getJob(jobId);
              if (!found) {
                return null;
              }
              return {
                status: found.status,
                error: found.error,
              };
            },
            pollExec: async (sessionId: string) => {
              const result = await deps.shell.process({
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
      if (job.type === "email_poll" && emailIngest) {
        const result = await emailIngest.pollNow();
        if (result.skipped) {
          return;
        }
      }
    },
  );
  await scheduler.init();
  if (deps.startAutomation) {
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
      enabled: config.email.enabled && deps.enableEmailPolling,
    });
    scheduler.start();
  }

  return {
    automation: new AutomationService(scheduler),
    ...(emailIngest ? { emailIngest } : {}),
  };
}
