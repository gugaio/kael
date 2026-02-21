import { describe, expect, it } from "vitest";
import type { KaelApp } from "../app.js";
import type { SchedulerJob } from "../automation/persistent-scheduler.js";
import { createApiServer } from "./server.js";

function makeFakeApp(): KaelApp {
  const schedules = new Map<string, SchedulerJob>();
  let chatCallCount = 0;

  schedules.set("heartbeat.main", {
    id: "heartbeat.main",
    type: "heartbeat",
    enabled: true,
    schedule: { kind: "interval", intervalMs: 30_000 },
    nextRunAt: new Date(Date.now() + 30_000).toISOString(),
  });

  return {
    config: {
      host: "127.0.0.1",
      port: 3210,
      dataDir: ".kael-data",
      engineMode: "simple",
      context: { maxMessages: 24, maxChars: 12_000 },
      idempotency: { enabled: true, ttlMs: 60_000 },
      automation: {
        heartbeatEnabled: true,
        heartbeatIntervalMs: 30_000,
        schedulerTickMs: 1_000,
      },
      execution: {
        safePathsEnabled: true,
        allowedPaths: ["/tmp"],
        maxJobArgs: 24,
        maxConcurrentJobs: 2,
        jobTimeoutMs: 60000,
        killGraceMs: 3000,
      },
      shell: {
        workspaceRoot: "/tmp",
        defaultTimeoutMs: 60_000,
        maxTimeoutMs: 900_000,
        maxOutputChars: 120_000,
        approvalWaitMs: 120_000,
        security: "allowlist",
        ask: "on-miss",
        allowlist: ["ls", "cat"],
      },
      pi: {
        enabled: true,
        provider: "openai",
        systemPrompt: "test",
        model: "gpt-4o-mini",
        timeoutMs: 45_000,
        retry: { attempts: 2, baseDelayMs: 10, maxDelayMs: 50, jitterMs: 10 },
      },
    },
    sessions: {
      countSessions: async () => 2,
    } as unknown as KaelApp["sessions"],
    jobs: {
      listJobs: () => [],
      getStatusCounts: () => ({
        queued: 1,
        running: 2,
        succeeded: 3,
        failed: 4,
        canceled: 0,
      }),
      getRuntimeStats: () => ({
        activeJobs: 1,
        queuedJobs: 2,
        maxConcurrentJobs: 2,
      }),
      getJob: () => null,
      getJobLog: async () => null,
      startTranscode: async () => ({ id: "j1" }),
      startConvertHls: async () => ({ id: "j2" }),
      startCaptureStream: async () => ({ id: "j3" }),
      startProbeMedia: async () => ({ id: "j4" }),
      cancelJob: async (jobId: string) => ({
        job: { id: jobId, status: "canceled" },
        canceled: true,
      }),
    } as unknown as KaelApp["jobs"],
    planner: {
      list: () => [],
      get: () => null,
      create: async ({
        sessionKey,
        title,
        steps,
      }: {
        sessionKey: string;
        title: string;
        steps: string[];
      }) => ({
        id: "plan-1",
        sessionKey,
        title,
        status: steps.length > 0 ? "active" : "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: steps.map((step: string, idx: number) => ({
          id: `st-${idx}`,
          title: step,
          status: "pending",
          updatedAt: new Date().toISOString(),
        })),
      }),
      generate: async ({
        sessionKey,
        objective,
      }: {
        sessionKey: string;
        objective: string;
      }) => ({
        id: "plan-generated",
        sessionKey,
        title: `Plano: ${objective}`,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [
          {
            id: "st-1",
            title: "Confirmar objetivo e entradas/saidas esperadas",
            status: "pending",
            updatedAt: new Date().toISOString(),
            checkpoints: [{ at: new Date().toISOString(), status: "pending" }],
          },
        ],
      }),
      updateStep: async () => null,
      appendStep: async () => null,
      nextAction: () => null,
      executeNext: async ({ planId }: { planId: string }) => ({
        ok: true,
        plan: {
          id: planId,
          sessionKey: "s1",
          title: "Plano fake",
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          steps: [
            {
              id: "st-1",
              title: "Executar transcode",
              status: "in_progress",
              updatedAt: new Date().toISOString(),
              checkpoints: [{ at: new Date().toISOString(), status: "in_progress" }],
              execution: {
                kind: "job",
                refId: "job-xyz",
                status: "queued",
                startedAt: new Date().toISOString(),
              },
            },
          ],
        },
        stepIndex: 0,
        action: "transcode",
        execution: {
          kind: "job",
          refId: "job-xyz",
          status: "queued",
          startedAt: new Date().toISOString(),
        },
      }),
    } as unknown as KaelApp["planner"],
    memory: {} as KaelApp["memory"],
    chat: {
      handleMessage: async ({ message }: { message: string }) => {
        chatCallCount += 1;
        return {
          reply: `echo:${message}`,
          user: {
            id: `u-${chatCallCount}`,
            sessionKey: "main",
            role: "user",
            content: message,
            createdAt: new Date().toISOString(),
          },
          assistant: {
            id: `a-${chatCallCount}`,
            sessionKey: "main",
            role: "assistant",
            content: `echo:${message}`,
            createdAt: new Date().toISOString(),
          },
        };
      },
      getHistory: async () => [],
    } as unknown as KaelApp["chat"],
    automation: {
      listSchedules: () => Array.from(schedules.values()),
      getSchedule: (id: string) => schedules.get(id) ?? null,
      upsertIntervalSchedule: async ({
        id,
        type,
        intervalMs,
        enabled,
      }: {
        id: string;
        type: string;
        intervalMs: number;
        enabled: boolean;
      }) => {
        const schedule: SchedulerJob = {
          id,
          type,
          enabled,
          schedule: { kind: "interval", intervalMs },
          nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
        };
        schedules.set(id, schedule);
        return schedule;
      },
      upsertCronSchedule: async ({
        id,
        type,
        cronExpr,
        enabled,
      }: {
        id: string;
        type: string;
        cronExpr: string;
        enabled: boolean;
      }) => {
        const schedule: SchedulerJob = {
          id,
          type,
          enabled,
          schedule: { kind: "cron", cronExpr },
          nextRunAt: new Date(Date.now() + 60_000).toISOString(),
        };
        schedules.set(id, schedule);
        return schedule;
      },
      setScheduleEnabled: async (id: string, enabled: boolean) => {
        const current = schedules.get(id);
        if (!current) {
          return null;
        }
        const next = { ...current, enabled };
        schedules.set(id, next);
        return next;
      },
    } as unknown as KaelApp["automation"],
    shell: {
      listApprovals: async () => [],
      resolveApproval: async () => null,
    } as unknown as KaelApp["shell"],
  };
}

describe("API integration", () => {
  it("returns standardized BAD_REQUEST for invalid /chat payload", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "POST",
      url: "/chat",
      payload: { sessionKey: "s1" },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.status).toBe(400);
    expect(typeof body.error.message).toBe("string");
    expect(typeof body.error.requestId).toBe("string");
    await server.close();
  });

  it("returns enriched /health metrics", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("kael");
    expect(typeof body.version).toBe("string");
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.metrics.sessions).toBe(2);
    expect(body.metrics.totalJobs).toBe(10);
    expect(body.metrics.jobsByStatus.failed).toBe(4);
    expect(body.metrics.runtimeJobs.activeJobs).toBe(1);
    expect(body.metrics.schedules.total).toBeGreaterThan(0);
    await server.close();
  });

  it("replays idempotent /chat and rejects key conflict", async () => {
    const server = createApiServer(makeFakeApp());

    const first = await server.inject({
      method: "POST",
      url: "/chat",
      headers: { "x-idempotency-key": "same-key" },
      payload: { sessionKey: "s1", message: "oi" },
    });
    expect(first.statusCode).toBe(200);

    const replay = await server.inject({
      method: "POST",
      url: "/chat",
      headers: { "x-idempotency-key": "same-key" },
      payload: { sessionKey: "s1", message: "oi" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["x-idempotency-replayed"]).toBe("true");

    const conflict = await server.inject({
      method: "POST",
      url: "/chat",
      headers: { "x-idempotency-key": "same-key" },
      payload: { sessionKey: "s1", message: "mensagem diferente" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

    await server.close();
  });

  it("upserts and pauses/resumes schedules through API", async () => {
    const server = createApiServer(makeFakeApp());

    const create = await server.inject({
      method: "POST",
      url: "/schedules",
      payload: {
        id: "heartbeat.secondary",
        type: "heartbeat",
        intervalMs: 5000,
        enabled: true,
      },
    });
    expect(create.statusCode).toBe(200);
    expect(create.json().schedule.id).toBe("heartbeat.secondary");

    const pause = await server.inject({
      method: "POST",
      url: "/schedules/heartbeat.secondary/pause",
    });
    expect(pause.statusCode).toBe(200);
    expect(pause.json().schedule.enabled).toBe(false);

    const resume = await server.inject({
      method: "POST",
      url: "/schedules/heartbeat.secondary/resume",
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().schedule.enabled).toBe(true);

    await server.close();
  });

  it("cancels job through API", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "POST",
      url: "/jobs/j123/cancel",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.canceled).toBe(true);
    expect(body.job.id).toBe("j123");
    await server.close();
  });

  it("generates plan through API", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "POST",
      url: "/plans/generate",
      payload: {
        sessionKey: "s1",
        objective: "transcodar e gerar hls",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.plan.id).toBe("plan-generated");
    expect(body.plan.title.toLowerCase()).toContain("transcodar");
    await server.close();
  });

  it("executes next plan step through API", async () => {
    const server = createApiServer(makeFakeApp());
    const response = await server.inject({
      method: "POST",
      url: "/plans/plan-1/execute-next",
      payload: {
        sessionKey: "s1",
        inputs: {
          inputPath: "/tmp/in.mp4",
          outputPath: "/tmp/out.mp4",
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.action).toBe("transcode");
    expect(body.execution.refId).toBe("job-xyz");
    await server.close();
  });

  it("lists and resolves exec approvals through API", async () => {
    const app = makeFakeApp();
    app.shell = {
      listApprovals: async () => [
        {
          id: "a1",
          command: "rm -rf /tmp/x",
          cwd: "/tmp",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          status: "pending",
        },
      ],
      resolveApproval: async (id: string, decision: "approved" | "denied") => ({
        id,
        command: "rm -rf /tmp/x",
        cwd: "/tmp",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: decision,
        decidedAt: new Date().toISOString(),
      }),
    } as unknown as KaelApp["shell"];
    const server = createApiServer(app);

    const listed = await server.inject({
      method: "GET",
      url: "/exec/approvals?status=open",
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().approvals.length).toBe(1);

    const approved = await server.inject({
      method: "POST",
      url: "/exec/approvals/a1/approve",
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().approval.status).toBe("approved");

    await server.close();
  });
});
