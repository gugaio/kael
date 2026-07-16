import type { KaelApp } from "../app.js";
import { stableStringify } from "../infra/idempotency-store.js";

export type LiveResource =
  | "health"
  | "jobs"
  | "schedules"
  | "plans"
  | "approvals"
  | "exec_sessions"
  | "mcp_servers"
  | "mcp_approvals";

export type LiveSyncEvent = {
  type: "sync";
  at: string;
  seq: number;
  changed: LiveResource[];
  summary: {
    jobs: number;
    plans: number;
    schedules: number;
    approvals: number;
    execSessions: number;
    mcpServers: number;
    mcpApprovals: number;
  };
};

export type LivePingEvent = {
  type: "ping";
  at: string;
  seq: number;
};

export async function buildLiveState(app: KaelApp): Promise<{
  signatures: Record<LiveResource, string>;
  summary: LiveSyncEvent["summary"];
}> {
  const jobs = app.agent.video.jobs.listJobs();
  const plans = app.agent.services.planner.list({ limit: 100 });
  const schedules = app.automation.listSchedules();
  const approvals = await app.agent.runtimes.shell.listApprovals({ status: "open", limit: 100 });
  const mcpServers = await app.agent.runtimes.mcp.listServers();
  const mcpApprovals = await app.agent.runtimes.mcp.listApprovals({ status: "open", limit: 100 });
  const execSessionsResult = await app.agent.runtimes.shell.process({
    sessionKey: "api.events",
    action: "list",
  });
  const execSessions = execSessionsResult.ok ? execSessionsResult.sessions ?? [] : [];
  const sessions = await app.agent.core.sessions.countSessions();
  const jobsByStatus = app.agent.video.jobs.getStatusCounts();
  const runtimeJobs = app.agent.video.jobs.getRuntimeStats();
  const chatRouting = app.chat.getRoutingTelemetrySnapshot();
  const engineRuntime = app.chat.getEngineRuntimeTelemetrySnapshot();
  const mediaRuntime = app.chat.getMediaRuntimeTelemetrySnapshot();
  const browserRuntime = app.chat.getBrowserRuntimeTelemetrySnapshot();
  const skillsRuntime = app.chat.getSkillsRuntimeTelemetrySnapshot();
  const mcpRuntime = app.agent.runtimes.mcp.getRuntimeTelemetrySnapshot();
  const emailIngest = app.emailIngest?.getRuntimeTelemetrySnapshot() ?? null;

  const healthSignature = stableStringify({
    sessions,
    jobsByStatus,
    runtimeJobs,
    chatRouting,
    engineRuntime,
    mediaRuntime,
    browserRuntime,
    skillsRuntime,
    mcpRuntime,
    emailIngest,
    engineMode: app.config.engineMode,
    piEnabled: app.config.pi.enabled,
  });

  const jobsSignature = stableStringify(
    jobs.map((job) => ({
      id: job.id,
      status: job.status,
      startedAt: job.startedAt ?? null,
      endedAt: job.endedAt ?? null,
      error: job.error ?? null,
    })),
  );

  const schedulesSignature = stableStringify(
    schedules.map((schedule) => ({
      id: schedule.id,
      enabled: schedule.enabled,
      nextRunAt: schedule.nextRunAt,
      schedule: schedule.schedule,
    })),
  );

  const plansSignature = stableStringify(
    plans.map((plan) => ({
      id: plan.id,
      status: plan.status,
      updatedAt: plan.updatedAt,
      steps: plan.steps.map((step) => ({
        id: step.id,
        status: step.status,
        updatedAt: step.updatedAt,
      })),
    })),
  );

  const approvalsSignature = stableStringify(
    approvals.map((approval) => ({
      id: approval.id,
      status: approval.status,
      command: approval.command,
      decidedAt: approval.decidedAt ?? null,
    })),
  );
  const execSessionsSignature = stableStringify(
    execSessions.map((session) => ({
      id: session.id,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? null,
      failureCode: session.failureCode ?? "none",
      approvalId: session.approvalId ?? null,
    })),
  );
  const mcpServersSignature = stableStringify(
    mcpServers.map((server) => ({
      name: server.name,
      transport: server.transport,
      enabled: server.enabled,
      requireApproval: server.requireApproval,
      updatedAt: server.updatedAt,
    })),
  );
  const mcpApprovalsSignature = stableStringify(
    mcpApprovals.map((approval) => ({
      id: approval.id,
      serverName: approval.serverName,
      transport: approval.transport,
      status: approval.status,
      decidedAt: approval.decidedAt ?? null,
    })),
  );

  return {
    signatures: {
      health: healthSignature,
      jobs: jobsSignature,
      schedules: schedulesSignature,
      plans: plansSignature,
      approvals: approvalsSignature,
      exec_sessions: execSessionsSignature,
      mcp_servers: mcpServersSignature,
      mcp_approvals: mcpApprovalsSignature,
    },
    summary: {
      jobs: jobs.length,
      plans: plans.length,
      schedules: schedules.length,
      approvals: approvals.length,
      execSessions: execSessions.length,
      mcpServers: mcpServers.length,
      mcpApprovals: mcpApprovals.length,
    },
  };
}
