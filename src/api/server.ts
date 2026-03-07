import Fastify, { type FastifyInstance } from "fastify";
import { createKaelApp, type KaelApp } from "../app.js";
import { IdempotencyConflictError, IdempotencyStore, stableStringify } from "../infra/idempotency-store.js";
import { kaelLogger } from "../infra/logger.js";
import { ApiError, asApiError, sendApiError } from "./errors.js";
import type { EngineInboundAttachment } from "../engine/types.js";

type RequestWithStart = {
  _kaelStartNs?: bigint;
};

type LiveResource = "health" | "jobs" | "schedules" | "plans" | "approvals" | "exec_sessions";

type LiveSyncEvent = {
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
  };
};

type LivePingEvent = {
  type: "ping";
  at: string;
  seq: number;
};

type PlannerExecuteRuntime = {
  startProbeMedia: (args: { sessionKey: string; inputPath: string }) => Promise<{ id: string; status: string }>;
  startCaptureStream: (args: {
    sessionKey: string;
    streamUrl: string;
    outputPath: string;
    durationSeconds?: number;
  }) => Promise<{ id: string; status: string }>;
  startTranscode: (args: {
    sessionKey: string;
    inputPath: string;
    outputPath: string;
    args?: string[];
  }) => Promise<{ id: string; status: string }>;
  startConvertHls: (args: {
    sessionKey: string;
    inputPath: string;
    outputPlaylistPath: string;
    segmentTime?: number;
  }) => Promise<{ id: string; status: string }>;
  execCommand: (args: {
    sessionKey: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
    background?: boolean;
  }) => Promise<{
    id: string;
    status: string;
    command: string;
    cwd: string;
    outputTail?: string;
    exitCode?: number | null;
  }>;
};

type PlannerReconcileRuntime = {
  getJob: (jobId: string) => Promise<{ status: string; error?: string } | null>;
  pollExec: (sessionId: string) => Promise<{ status: string; message?: string } | null>;
};

function createPlannerExecuteRuntime(app: KaelApp): PlannerExecuteRuntime {
  return {
    startProbeMedia: (args) => app.jobs.startProbeMedia(args),
    startCaptureStream: (args) => app.jobs.startCaptureStream(args),
    startTranscode: (args) => app.jobs.startTranscode(args),
    startConvertHls: (args) => app.jobs.startConvertHls(args),
    execCommand: (args) =>
      app.shell.exec({
        sessionKey: args.sessionKey,
        command: args.command,
        cwd: args.cwd,
        timeoutMs: args.timeoutMs,
        background: args.background,
      }),
  };
}

function createPlannerReconcileRuntime(app: KaelApp, sessionKey = "planner.reconcile"): PlannerReconcileRuntime {
  return {
    getJob: async (jobId: string) => {
      const found = app.jobs.getJob(jobId);
      if (!found) {
        return null;
      }
      return {
        status: found.status,
        error: found.error,
      };
    },
    pollExec: async (sessionId: string) => {
      const poll = await app.shell.process({
        sessionKey,
        action: "poll",
        sessionId,
      });
      if (!poll.ok || !poll.session) {
        return null;
      }
      return {
        status: poll.session.status,
        message: poll.message,
      };
    },
  };
}

async function buildLiveState(app: KaelApp): Promise<{
  signatures: Record<LiveResource, string>;
  summary: LiveSyncEvent["summary"];
}> {
  const jobs = app.jobs.listJobs();
  const plans = app.planner.list({ limit: 100 });
  const schedules = app.automation.listSchedules();
  const approvals = await app.shell.listApprovals({ status: "open", limit: 100 });
  const execSessionsResult = await app.shell.process({
    sessionKey: "api.events",
    action: "list",
  });
  const execSessions = execSessionsResult.ok ? execSessionsResult.sessions ?? [] : [];
  const sessions = await app.sessions.countSessions();
  const jobsByStatus = app.jobs.getStatusCounts();
  const runtimeJobs = app.jobs.getRuntimeStats();
  const chatRouting = app.chat.getRoutingTelemetrySnapshot();
  const engineRuntime = app.chat.getEngineRuntimeTelemetrySnapshot();
  const mediaRuntime = app.chat.getMediaRuntimeTelemetrySnapshot();
  const browserRuntime = app.chat.getBrowserRuntimeTelemetrySnapshot();
  const emailIngest = app.emailIngest?.getRuntimeTelemetrySnapshot() ?? null;

  const healthSignature = stableStringify({
    sessions,
    jobsByStatus,
    runtimeJobs,
    chatRouting,
    engineRuntime,
    mediaRuntime,
    browserRuntime,
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

  return {
    signatures: {
      health: healthSignature,
      jobs: jobsSignature,
      schedules: schedulesSignature,
      plans: plansSignature,
      approvals: approvalsSignature,
      exec_sessions: execSessionsSignature,
    },
    summary: {
      jobs: jobs.length,
      plans: plans.length,
      schedules: schedules.length,
      approvals: approvals.length,
      execSessions: execSessions.length,
    },
  };
}

function readIdempotencyKey(headerValue: string | string[] | undefined): string | null {
  if (Array.isArray(headerValue)) {
    return readIdempotencyKey(headerValue[0]);
  }
  const value = headerValue?.trim();
  return value ? value : null;
}

function bodySessionKey(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const value = (body as { sessionKey?: unknown }).sessionKey;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeInboundAttachments(raw: unknown): EngineInboundAttachment[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: EngineInboundAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new ApiError(400, "BAD_REQUEST", "attachments invalidos");
    }
    const kindRaw = (item as { kind?: unknown }).kind;
    const kind = kindRaw === "image" || kindRaw === "audio" ? kindRaw : null;
    const dataBase64 = (item as { dataBase64?: unknown }).dataBase64;
    if (!kind || typeof dataBase64 !== "string" || !dataBase64.trim()) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "attachment invalido: use {kind: image|audio, dataBase64: string}",
      );
    }
    const mimeTypeRaw = (item as { mimeType?: unknown }).mimeType;
    const fileNameRaw = (item as { fileName?: unknown }).fileName;
    out.push({
      kind,
      dataBase64: dataBase64.trim(),
      mimeType: typeof mimeTypeRaw === "string" ? mimeTypeRaw.trim() || undefined : undefined,
      fileName: typeof fileNameRaw === "string" ? fileNameRaw.trim() || undefined : undefined,
    });
  }
  return out;
}

async function withIdempotency<T>(params: {
  store: IdempotencyStore;
  enabled: boolean;
  scope: string;
  idempotencyKey: string | null;
  signature: string;
  execute: () => Promise<T>;
}): Promise<{ replayed: boolean; value: T }> {
  if (!params.enabled || !params.idempotencyKey) {
    return { replayed: false, value: await params.execute() };
  }

  return params.store.execute({
    key: `${params.scope}:${params.idempotencyKey}`,
    signature: params.signature,
    handler: params.execute,
  });
}

export function createApiServer(app: KaelApp): FastifyInstance {
  const server = Fastify({ logger: false });
  const idempotency = new IdempotencyStore(app.config.idempotency.ttlMs);
  const plannerExecuteRuntime = createPlannerExecuteRuntime(app);
  const plannerReconcileRuntime = createPlannerReconcileRuntime(app);
  const reconcilePlansNow = async (params?: { planId?: string; limit?: number }): Promise<void> => {
    try {
      await app.planner.reconcile({
        planId: params?.planId,
        limit: params?.limit,
        runtime: plannerReconcileRuntime,
      });
    } catch (error) {
      kaelLogger.warn("planner.reconcile.on_demand_failed", {
        planId: params?.planId ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  server.addHook("onRequest", async (request) => {
    (request as unknown as RequestWithStart)._kaelStartNs = process.hrtime.bigint();
  });

  server.addHook("onResponse", async (request, reply) => {
    const startNs = (request as unknown as RequestWithStart)._kaelStartNs;
    const route = request.routeOptions?.url ?? request.url;
    const durationMs =
      typeof startNs === "bigint" ? Number((process.hrtime.bigint() - startNs) / BigInt(1_000_000)) : null;

    kaelLogger.info("api.request", {
      requestId: request.id,
      method: request.method,
      route,
      status: reply.statusCode,
      durationMs,
      sessionKey: bodySessionKey(request.body),
    });
  });

  server.setErrorHandler(async (error, request, reply) => {
    const apiError = asApiError(error);
    const route = request.routeOptions?.url ?? request.url;
    const cause =
      apiError.details && typeof apiError.details === "object" && "cause" in apiError.details
        ? (apiError.details as { cause?: unknown }).cause
        : undefined;
    kaelLogger.error("api.request.error", {
      requestId: request.id,
      method: request.method,
      route,
      status: apiError.status,
      code: apiError.code,
      message: apiError.message,
      ...(cause !== undefined ? { cause } : {}),
    });
    return sendApiError(reply, request, apiError);
  });

  server.get("/health", async () => {
    const sessions = await app.sessions.countSessions();
    const jobsByStatus = app.jobs.getStatusCounts();
    const runtimeJobs = app.jobs.getRuntimeStats();
    const chatRouting = app.chat.getRoutingTelemetrySnapshot();
    const engineRuntime = app.chat.getEngineRuntimeTelemetrySnapshot();
    const mediaRuntime = app.chat.getMediaRuntimeTelemetrySnapshot();
    const browserRuntime = app.chat.getBrowserRuntimeTelemetrySnapshot();
    const emailIngest = app.emailIngest?.getRuntimeTelemetrySnapshot() ?? null;
    const schedules = app.automation.listSchedules();
    const enabledSchedules = schedules.filter((item) => item.enabled).length;
    const version = process.env.KAEL_VERSION?.trim() || process.env.npm_package_version || "0.1.0";

    return {
      ok: true,
      service: "kael",
      version,
      now: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      engineMode: app.config.engineMode,
      piEnabled: app.config.pi.enabled,
      metrics: {
        sessions,
        totalJobs: Object.values(jobsByStatus).reduce((sum, value) => sum + value, 0),
        jobsByStatus,
        runtimeJobs,
        chatRouting,
        engineRuntime,
        mediaRuntime,
        browserRuntime,
        emailIngest,
        schedules: {
          total: schedules.length,
          enabled: enabledSchedules,
          disabled: schedules.length - enabledSchedules,
        },
      },
    };
  });

  server.get("/events/stream", async (request, reply) => {
    reply.hijack();

    const response = reply.raw;
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    let closed = false;
    let seq = 0;
    let previous = await buildLiveState(app);

    const writeEvent = (eventName: "sync" | "ping", payload: LiveSyncEvent | LivePingEvent): void => {
      if (closed) {
        return;
      }
      response.write(`event: ${eventName}\n`);
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const writePing = (): void => {
      seq += 1;
      writeEvent("ping", {
        type: "ping",
        at: new Date().toISOString(),
        seq,
      });
    };

    const writeSync = (changed: LiveResource[], summary: LiveSyncEvent["summary"]): void => {
      if (changed.length === 0) {
        return;
      }
      seq += 1;
      writeEvent("sync", {
        type: "sync",
        at: new Date().toISOString(),
        seq,
        changed,
        summary,
      });
    };

    writeSync(["health", "jobs", "schedules", "plans", "approvals", "exec_sessions"], previous.summary);

    const syncTimer = setInterval(() => {
      void (async () => {
        if (closed) {
          return;
        }
        try {
          const current = await buildLiveState(app);
          const changed = (Object.keys(current.signatures) as LiveResource[]).filter(
            (resource) => current.signatures[resource] !== previous.signatures[resource],
          );
          previous = current;
          writeSync(changed, current.summary);
        } catch (error) {
          kaelLogger.warn("api.events.stream.sync_failed", {
            requestId: request.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    }, 1500);

    const pingTimer = setInterval(() => {
      writePing();
    }, 15_000);

    const cleanup = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(syncTimer);
      clearInterval(pingTimer);
      try {
        response.end();
      } catch {
        // ignore
      }
    };

    request.raw.on("close", cleanup);
    request.raw.on("error", cleanup);
  });

  server.post<{
    Body: {
      sessionKey?: string;
      message?: string;
      attachments?: Array<{
        kind?: "image" | "audio";
        dataBase64?: string;
        mimeType?: string;
        fileName?: string;
      }>;
    };
    Querystring: { includeMessages?: string };
  }>("/chat", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const message = request.body.message?.trim();
    const attachments = normalizeInboundAttachments(request.body.attachments);
    const includeMessages = request.query.includeMessages?.trim().toLowerCase() === "true";

    if (!message) {
      throw new ApiError(400, "BAD_REQUEST", "message is required");
    }

    const idempotencyKey = readIdempotencyKey(request.headers["x-idempotency-key"]);
    try {
      const { replayed, value } = await withIdempotency({
        store: idempotency,
        enabled: app.config.idempotency.enabled,
        scope: "chat",
        idempotencyKey,
        signature: stableStringify({ sessionKey, message, attachments, includeMessages }),
        execute: async () => {
          const result = await app.chat.handleMessage({
            sessionKey,
            message,
            attachments,
            source: "api",
            requestId: request.id,
          });
          const response: {
            ok: true;
            sessionKey: string;
            reply: string;
            user?: typeof result.user;
            assistant?: typeof result.assistant;
          } = {
            ok: true,
            sessionKey,
            reply: result.reply,
          };
          if (includeMessages) {
            response.user = result.user;
            response.assistant = result.assistant;
          }
          return response;
        },
      });
      if (replayed) {
        reply.header("x-idempotency-replayed", "true");
      }
      return value;
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", error.message);
      }
      throw error;
    }
  });

  server.get<{ Params: { sessionKey: string }; Querystring: { limit?: string } }>(
    "/sessions/:sessionKey/messages",
    async (request) => {
      const parsedLimit = Number(request.query.limit ?? "50");
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
      const messages = await app.chat.getHistory(request.params.sessionKey, limit);
      return { ok: true, messages };
    },
  );

  server.get<{
    Querystring: {
      sessionKey?: string;
      status?: string;
      limit?: string;
    };
  }>("/plans", async (request) => {
    const statusRaw = request.query.status?.trim().toLowerCase();
    const status =
      statusRaw === "active" ||
      statusRaw === "completed" ||
      statusRaw === "blocked" ||
      statusRaw === "failed" ||
      statusRaw === "canceled"
        ? statusRaw
        : undefined;
    const parsedLimit = Number(request.query.limit ?? "50");
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
    const plans = app.planner.list({
      sessionKey: request.query.sessionKey?.trim(),
      status,
      limit,
    });
    return { ok: true, plans };
  });

  server.get<{ Params: { planId: string } }>("/plans/:planId", async (request) => {
    const planId = request.params.planId?.trim();
    if (!planId) {
      throw new ApiError(400, "BAD_REQUEST", "planId is required");
    }
    const plan = app.planner.get(planId);
    if (!plan) {
      throw new ApiError(404, "NOT_FOUND", `plan ${planId} not found`);
    }
    return { ok: true, plan };
  });

  server.post<{
    Body: {
      sessionKey?: string;
      title?: string;
      steps?: string[];
    };
  }>("/plans", async (request) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const title = request.body.title?.trim() || "Plano de execucao";
    const steps = Array.isArray(request.body.steps) ? request.body.steps : [];
    const plan = await app.planner.create({ sessionKey, title, steps });
    return { ok: true, plan };
  });

  server.post<{
    Body: {
      sessionKey?: string;
      objective?: string;
      maxSteps?: number;
    };
  }>("/plans/generate", async (request) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const objective = request.body.objective?.trim();
    if (!objective) {
      throw new ApiError(400, "BAD_REQUEST", "objective is required");
    }
    const maxStepsRaw = Number(request.body.maxSteps);
    const maxSteps = Number.isFinite(maxStepsRaw) && maxStepsRaw > 0 ? Math.floor(maxStepsRaw) : undefined;
    const plan = await app.planner.generate({
      sessionKey,
      objective,
      maxSteps,
    });
    return { ok: true, plan };
  });

  server.post<{
    Params: { planId: string; stepIndex: string };
    Body: {
      status?: string;
      notes?: string;
    };
  }>("/plans/:planId/steps/:stepIndex", async (request) => {
    const planId = request.params.planId?.trim();
    const stepIndex = Number(request.params.stepIndex);
    const statusRaw = request.body.status?.trim().toLowerCase();
    const status =
      statusRaw === "pending" ||
      statusRaw === "in_progress" ||
      statusRaw === "completed" ||
      statusRaw === "blocked" ||
      statusRaw === "failed" ||
      statusRaw === "canceled"
        ? statusRaw
        : null;
    if (!planId) {
      throw new ApiError(400, "BAD_REQUEST", "planId is required");
    }
    if (!Number.isFinite(stepIndex) || stepIndex < 0) {
      throw new ApiError(400, "BAD_REQUEST", "stepIndex must be a non-negative number");
    }
    if (!status) {
      throw new ApiError(400, "BAD_REQUEST", "valid step status is required");
    }

    const plan = await app.planner.updateStep({
      planId,
      stepIndex: Math.floor(stepIndex),
      status,
      notes: request.body.notes,
    });
    if (!plan) {
      throw new ApiError(404, "NOT_FOUND", "plan/step not found");
    }
    return { ok: true, plan };
  });

  server.post<{
    Params: { planId: string };
    Body: {
      sessionKey?: string;
      inputs?: {
        inputPath?: string;
        outputPath?: string;
        outputPlaylistPath?: string;
        streamUrl?: string;
        durationSeconds?: number;
        segmentTime?: number;
        args?: string[];
        command?: string;
        cwd?: string;
        timeoutMs?: number;
        background?: boolean;
      };
    };
  }>("/plans/:planId/execute-next", async (request) => {
    const planId = request.params.planId?.trim();
    if (!planId) {
      throw new ApiError(400, "BAD_REQUEST", "planId is required");
    }
    const result = await app.planner.executeNext({
      planId,
      sessionKey: request.body.sessionKey?.trim(),
      inputs: request.body.inputs,
      runtime: plannerExecuteRuntime,
    });

    // Event-driven reconcile: update step/plan status ASAP after triggering execution.
    await reconcilePlansNow({ planId, limit: 1 });

    return result;
  });

  server.post<{
    Params: { planId: string };
    Body: {
      note?: string;
    };
  }>("/plans/:planId/cancel", async (request) => {
    const planId = request.params.planId?.trim();
    if (!planId) {
      throw new ApiError(400, "BAD_REQUEST", "planId is required");
    }
    const plan = await app.planner.cancelPlan({
      planId,
      note: request.body.note,
    });
    if (!plan) {
      throw new ApiError(404, "NOT_FOUND", `plan ${planId} not found`);
    }
    return { ok: true, plan };
  });

  server.post<{
    Body: {
      planId?: string;
      limit?: number;
    };
  }>("/plans/reconcile", async (request) => {
    const planId = request.body.planId?.trim();
    const limitRaw = Number(request.body.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined;
    const result = await app.planner.reconcile({
      planId,
      limit,
      runtime: plannerReconcileRuntime,
    });
    return { ok: true, ...result };
  });

  server.get<{ Querystring: { status?: string; limit?: string } }>(
    "/exec/approvals",
    async (request) => {
      const statusRaw = request.query.status?.trim().toLowerCase();
      const status =
        statusRaw === "open" ||
        statusRaw === "pending" ||
        statusRaw === "approved" ||
        statusRaw === "denied" ||
        statusRaw === "expired"
          ? statusRaw
          : undefined;
      const parsedLimit = Number(request.query.limit ?? "100");
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100;
      const approvals = await app.shell.listApprovals({ status, limit });
      return { ok: true, approvals };
    },
  );

  server.post<{ Params: { approvalId: string } }>(
    "/exec/approvals/:approvalId/approve",
    async (request) => {
      const approvalId = request.params.approvalId?.trim();
      if (!approvalId) {
        throw new ApiError(400, "BAD_REQUEST", "approvalId is required");
      }
      const approval = await app.shell.resolveApproval(approvalId, "approved");
      if (!approval) {
        throw new ApiError(404, "NOT_FOUND", "approval not found");
      }
      await reconcilePlansNow({ limit: 200 });
      return { ok: true, approval };
    },
  );

  server.post<{ Params: { approvalId: string } }>(
    "/exec/approvals/:approvalId/deny",
    async (request) => {
      const approvalId = request.params.approvalId?.trim();
      if (!approvalId) {
        throw new ApiError(400, "BAD_REQUEST", "approvalId is required");
      }
      const approval = await app.shell.resolveApproval(approvalId, "denied");
      if (!approval) {
        throw new ApiError(404, "NOT_FOUND", "approval not found");
      }
      await reconcilePlansNow({ limit: 200 });
      return { ok: true, approval };
    },
  );

  server.get<{ Querystring: { status?: string; limit?: string } }>(
    "/exec/sessions",
    async (request) => {
      const list = await app.shell.process({
        sessionKey: "api.exec.sessions",
        action: "list",
      });
      if (!list.ok) {
        throw new ApiError(500, "INTERNAL_ERROR", list.message ?? "failed to list exec sessions");
      }

      const status = request.query.status?.trim().toLowerCase();
      const parsedLimit = Number(request.query.limit ?? "100");
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 100;
      const filtered =
        status && status !== "all"
          ? (list.sessions ?? []).filter((session) => session.status.toLowerCase() === status)
          : list.sessions ?? [];
      return { ok: true, sessions: filtered.slice(0, limit) };
    },
  );

  server.get<{ Params: { sessionId: string }; Querystring: { offset?: string; limit?: string } }>(
    "/exec/sessions/:sessionId/log",
    async (request) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        throw new ApiError(400, "BAD_REQUEST", "sessionId is required");
      }
      const offsetRaw = Number(request.query.offset ?? "0");
      const limitRaw = Number(request.query.limit ?? "8000");
      const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 8000;

      const result = await app.shell.process({
        sessionKey: "api.exec.sessions",
        action: "log",
        sessionId,
        offset,
        limit,
      });

      if (!result.ok || !result.session) {
        throw new ApiError(404, "NOT_FOUND", result.message ?? "session not found");
      }

      return {
        ok: true,
        session: result.session,
        output: result.output ?? "",
        page: result.message ?? "",
      };
    },
  );

  server.post<{
    Body: {
      sessionKey?: string;
      inputPath?: string;
      outputPath?: string;
      args?: string[];
    };
  }>("/jobs/transcode", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const inputPath = request.body.inputPath?.trim();
    const outputPath = request.body.outputPath?.trim();

    if (!inputPath || !outputPath) {
      throw new ApiError(400, "BAD_REQUEST", "inputPath and outputPath are required");
    }

    const args = request.body.args;
    const idempotencyKey = readIdempotencyKey(request.headers["x-idempotency-key"]);
    try {
      const { replayed, value } = await withIdempotency({
        store: idempotency,
        enabled: app.config.idempotency.enabled,
        scope: "jobs:transcode",
        idempotencyKey,
        signature: stableStringify({ sessionKey, inputPath, outputPath, args }),
        execute: async () => {
          const job = await app.jobs.startTranscode({ sessionKey, inputPath, outputPath, args });
          return { ok: true, job };
        },
      });
      if (replayed) {
        reply.header("x-idempotency-replayed", "true");
      }
      return value;
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", error.message);
      }
      throw error;
    }
  });

  server.post<{
    Body: {
      sessionKey?: string;
      input?: string;
    };
  }>("/jobs/vlc", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const input = request.body.input?.trim();

    if (!input) {
      throw new ApiError(400, "BAD_REQUEST", "input is required");
    }

    const idempotencyKey = readIdempotencyKey(request.headers["x-idempotency-key"]);
    try {
      const { replayed, value } = await withIdempotency({
        store: idempotency,
        enabled: app.config.idempotency.enabled,
        scope: "jobs:vlc",
        idempotencyKey,
        signature: stableStringify({ sessionKey, input }),
        execute: async () => {
          const job = await app.jobs.startPlayVlc({ sessionKey, input });
          return { ok: true, job };
        },
      });
      if (replayed) {
        reply.header("x-idempotency-replayed", "true");
      }
      return value;
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", error.message);
      }
      throw error;
    }
  });

  server.post<{
    Body: {
      sessionKey?: string;
      inputPath?: string;
      outputPlaylistPath?: string;
      segmentTime?: number;
    };
  }>("/jobs/hls", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const inputPath = request.body.inputPath?.trim();
    const outputPlaylistPath = request.body.outputPlaylistPath?.trim();

    if (!inputPath || !outputPlaylistPath) {
      throw new ApiError(400, "BAD_REQUEST", "inputPath and outputPlaylistPath are required");
    }

    const segmentTime = request.body.segmentTime;
    const idempotencyKey = readIdempotencyKey(request.headers["x-idempotency-key"]);
    try {
      const { replayed, value } = await withIdempotency({
        store: idempotency,
        enabled: app.config.idempotency.enabled,
        scope: "jobs:hls",
        idempotencyKey,
        signature: stableStringify({ sessionKey, inputPath, outputPlaylistPath, segmentTime }),
        execute: async () => {
          const job = await app.jobs.startConvertHls({
            sessionKey,
            inputPath,
            outputPlaylistPath,
            segmentTime,
          });
          return { ok: true, job };
        },
      });
      if (replayed) {
        reply.header("x-idempotency-replayed", "true");
      }
      return value;
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", error.message);
      }
      throw error;
    }
  });

  server.post<{
    Body: {
      sessionKey?: string;
      streamUrl?: string;
      outputPath?: string;
      durationSeconds?: number;
    };
  }>("/jobs/capture", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const streamUrl = request.body.streamUrl?.trim();
    const outputPath = request.body.outputPath?.trim();

    if (!streamUrl || !outputPath) {
      throw new ApiError(400, "BAD_REQUEST", "streamUrl and outputPath are required");
    }

    const durationSeconds = request.body.durationSeconds;
    const idempotencyKey = readIdempotencyKey(request.headers["x-idempotency-key"]);
    try {
      const { replayed, value } = await withIdempotency({
        store: idempotency,
        enabled: app.config.idempotency.enabled,
        scope: "jobs:capture",
        idempotencyKey,
        signature: stableStringify({ sessionKey, streamUrl, outputPath, durationSeconds }),
        execute: async () => {
          const job = await app.jobs.startCaptureStream({
            sessionKey,
            streamUrl,
            outputPath,
            durationSeconds,
          });
          return { ok: true, job };
        },
      });
      if (replayed) {
        reply.header("x-idempotency-replayed", "true");
      }
      return value;
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", error.message);
      }
      throw error;
    }
  });

  server.post<{
    Body: {
      sessionKey?: string;
      inputPath?: string;
    };
  }>("/jobs/probe-url", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const streamUrl = request.body.inputPath?.trim();

    if (!streamUrl) {
      throw new ApiError(400, "BAD_REQUEST", "inputPath is required");
    }

    const idempotencyKey = readIdempotencyKey(request.headers["x-idempotency-key"]);
    try {
      const { replayed, value } = await withIdempotency({
        store: idempotency,
        enabled: app.config.idempotency.enabled,
        scope: "jobs:probe-url",
        idempotencyKey,
        signature: stableStringify({ sessionKey, streamUrl }),
        execute: async () => {
          const job = await app.jobs.startProbeUrl({ sessionKey, streamUrl });
          return { ok: true, job };
        },
      });
      if (replayed) {
        reply.header("x-idempotency-replayed", "true");
      }
      return value;
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", error.message);
      }
      throw error;
    }
  });

  server.post<{
    Body: {
      sessionKey?: string;
      inputPath?: string;
    };
  }>("/jobs/probe", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const inputPath = request.body.inputPath?.trim();

    if (!inputPath) {
      throw new ApiError(400, "BAD_REQUEST", "inputPath is required");
    }

    const idempotencyKey = readIdempotencyKey(request.headers["x-idempotency-key"]);
    try {
      const { replayed, value } = await withIdempotency({
        store: idempotency,
        enabled: app.config.idempotency.enabled,
        scope: "jobs:probe",
        idempotencyKey,
        signature: stableStringify({ sessionKey, inputPath }),
        execute: async () => {
          const job = await app.jobs.startProbeMedia({ sessionKey, inputPath });
          return { ok: true, job };
        },
      });
      if (replayed) {
        reply.header("x-idempotency-replayed", "true");
      }
      return value;
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", error.message);
      }
      throw error;
    }
  });

  server.get("/jobs", async () => ({ ok: true, jobs: app.jobs.listJobs() }));

  server.get<{ Params: { jobId: string } }>("/jobs/:jobId", async (request) => {
    const job = app.jobs.getJob(request.params.jobId);
    if (!job) {
      throw new ApiError(404, "NOT_FOUND", "job not found");
    }
    return { ok: true, job };
  });

  server.get<{ Params: { jobId: string } }>("/jobs/:jobId/log", async (request) => {
    const log = await app.jobs.getJobLog(request.params.jobId);
    if (log === null) {
      throw new ApiError(404, "NOT_FOUND", "job not found");
    }
    return { ok: true, log };
  });

  server.post<{ Params: { jobId: string } }>("/jobs/:jobId/cancel", async (request) => {
    const result = await app.jobs.cancelJob(request.params.jobId);
    if (!result.job) {
      throw new ApiError(404, "NOT_FOUND", "job not found");
    }
    return {
      ok: true,
      canceled: result.canceled,
      job: result.job,
    };
  });

  server.get("/schedules", async () => ({
    ok: true,
    schedules: app.automation.listSchedules(),
  }));

  server.get<{ Params: { scheduleId: string } }>("/schedules/:scheduleId", async (request) => {
    const schedule = app.automation.getSchedule(request.params.scheduleId);
    if (!schedule) {
      throw new ApiError(404, "NOT_FOUND", "schedule not found");
    }
    return { ok: true, schedule };
  });

  server.post<{
    Body: {
      id?: string;
      type?: string;
      enabled?: boolean;
      intervalMs?: number;
      cronExpr?: string;
    };
  }>("/schedules", async (request) => {
    const id = request.body.id?.trim();
    const type = request.body.type?.trim();
    const enabled = request.body.enabled ?? true;
    const intervalMs = request.body.intervalMs;
    const cronExpr = request.body.cronExpr?.trim();

    if (!id || !type) {
      throw new ApiError(400, "BAD_REQUEST", "id and type are required");
    }

    if (intervalMs != null && cronExpr) {
      throw new ApiError(400, "BAD_REQUEST", "provide either intervalMs or cronExpr");
    }

    try {
      if (cronExpr) {
        const schedule = await app.automation.upsertCronSchedule({
          id,
          type,
          cronExpr,
          enabled,
        });
        return { ok: true, schedule };
      }

      if (intervalMs == null || !Number.isFinite(intervalMs) || intervalMs <= 0) {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          "intervalMs must be a positive number when cronExpr is not provided",
        );
      }

      const schedule = await app.automation.upsertIntervalSchedule({
        id,
        type,
        intervalMs: Math.floor(intervalMs),
        enabled,
      });
      return { ok: true, schedule };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(400, "BAD_REQUEST", error instanceof Error ? error.message : String(error));
    }
  });

  server.post<{ Params: { scheduleId: string } }>("/schedules/:scheduleId/pause", async (request) => {
    const schedule = await app.automation.setScheduleEnabled(request.params.scheduleId, false);
    if (!schedule) {
      throw new ApiError(404, "NOT_FOUND", "schedule not found");
    }
    return { ok: true, schedule };
  });

  server.post<{ Params: { scheduleId: string } }>("/schedules/:scheduleId/resume", async (request) => {
    const schedule = await app.automation.setScheduleEnabled(request.params.scheduleId, true);
    if (!schedule) {
      throw new ApiError(404, "NOT_FOUND", "schedule not found");
    }
    return { ok: true, schedule };
  });

  return server;
}

export async function startApiServer(): Promise<void> {
  const app = await createKaelApp();
  const server = createApiServer(app);
  await server.listen({ host: app.config.host, port: app.config.port });
  kaelLogger.info("api.server.started", {
    host: app.config.host,
    port: app.config.port,
    engineMode: app.config.engineMode,
  });
}
