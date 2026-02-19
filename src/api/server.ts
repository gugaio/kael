import Fastify, { type FastifyInstance } from "fastify";
import { createKaelApp, type KaelApp } from "../app.js";
import { IdempotencyConflictError, IdempotencyStore, stableStringify } from "../infra/idempotency-store.js";
import { kaelLogger } from "../infra/logger.js";
import { ApiError, asApiError, sendApiError } from "./errors.js";

type RequestWithStart = {
  _kaelStartNs?: bigint;
};

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

  server.addHook("onRequest", async (request) => {
    (request as unknown as RequestWithStart)._kaelStartNs = process.hrtime.bigint();
  });

  server.addHook("onResponse", async (request, reply) => {
    const startNs = (request as unknown as RequestWithStart)._kaelStartNs;
    const durationMs =
      typeof startNs === "bigint" ? Number((process.hrtime.bigint() - startNs) / BigInt(1_000_000)) : null;

    kaelLogger.info("api.request", {
      requestId: request.id,
      method: request.method,
      route: request.routerPath ?? request.url,
      status: reply.statusCode,
      durationMs,
      sessionKey: bodySessionKey(request.body),
    });
  });

  server.setErrorHandler(async (error, request, reply) => {
    const apiError = asApiError(error);
    kaelLogger.error("api.request.error", {
      requestId: request.id,
      method: request.method,
      route: request.routerPath ?? request.url,
      status: apiError.status,
      code: apiError.code,
      message: apiError.message,
    });
    return sendApiError(reply, request, apiError);
  });

  server.get("/health", async () => {
    const sessions = await app.sessions.countSessions();
    const jobsByStatus = app.jobs.getStatusCounts();
    const runtimeJobs = app.jobs.getRuntimeStats();
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
        schedules: {
          total: schedules.length,
          enabled: enabledSchedules,
          disabled: schedules.length - enabledSchedules,
        },
      },
    };
  });

  server.post<{
    Body: { sessionKey?: string; message?: string };
    Querystring: { includeMessages?: string };
  }>("/chat", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const message = request.body.message?.trim();
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
        signature: stableStringify({ sessionKey, message, includeMessages }),
        execute: async () => {
          const result = await app.chat.handleMessage({ sessionKey, message });
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
