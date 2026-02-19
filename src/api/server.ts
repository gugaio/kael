import Fastify from "fastify";
import { createKaelApp } from "../app.js";
import {
  IdempotencyConflictError,
  IdempotencyStore,
  stableStringify,
} from "../infra/idempotency-store.js";

function readIdempotencyKey(headerValue: string | string[] | undefined): string | null {
  if (Array.isArray(headerValue)) {
    return readIdempotencyKey(headerValue[0]);
  }
  const value = headerValue?.trim();
  return value ? value : null;
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

export async function startApiServer(): Promise<void> {
  const app = await createKaelApp();
  const server = Fastify({ logger: true });
  const idempotency = new IdempotencyStore(app.config.idempotency.ttlMs);

  server.get("/health", async () => ({
    ok: true,
    service: "kael",
    now: new Date().toISOString(),
    engineMode: app.config.engineMode,
    piEnabled: app.config.pi.enabled,
  }));

  server.post<{
    Body: { sessionKey?: string; message?: string };
    Querystring: { includeMessages?: string };
  }>("/chat", async (request, reply) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const message = request.body.message?.trim();
    const includeMessages = request.query.includeMessages?.trim().toLowerCase() === "true";

    if (!message) {
      return reply.code(400).send({ ok: false, error: "message is required" });
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
        return reply.code(409).send({ ok: false, error: error.message });
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
      return reply.code(400).send({ ok: false, error: "inputPath and outputPath are required" });
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
        return reply.code(409).send({ ok: false, error: error.message });
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
      return reply.code(400).send({ ok: false, error: "inputPath and outputPlaylistPath are required" });
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
        return reply.code(409).send({ ok: false, error: error.message });
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
      return reply.code(400).send({ ok: false, error: "streamUrl and outputPath are required" });
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
        return reply.code(409).send({ ok: false, error: error.message });
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
      return reply.code(400).send({ ok: false, error: "inputPath is required" });
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
        return reply.code(409).send({ ok: false, error: error.message });
      }
      throw error;
    }
  });

  server.get("/jobs", async () => ({ ok: true, jobs: app.jobs.listJobs() }));

  server.get<{ Params: { jobId: string } }>("/jobs/:jobId", async (request, reply) => {
    const job = app.jobs.getJob(request.params.jobId);
    if (!job) {
      return reply.code(404).send({ ok: false, error: "job not found" });
    }
    return { ok: true, job };
  });

  server.get<{ Params: { jobId: string } }>("/jobs/:jobId/log", async (request, reply) => {
    const log = await app.jobs.getJobLog(request.params.jobId);
    if (log === null) {
      return reply.code(404).send({ ok: false, error: "job not found" });
    }
    return { ok: true, log };
  });

  server.get("/schedules", async () => ({
    ok: true,
    schedules: app.automation.listSchedules(),
  }));

  server.get<{ Params: { scheduleId: string } }>("/schedules/:scheduleId", async (request, reply) => {
    const schedule = app.automation.getSchedule(request.params.scheduleId);
    if (!schedule) {
      return reply.code(404).send({ ok: false, error: "schedule not found" });
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
  }>("/schedules", async (request, reply) => {
    const id = request.body.id?.trim();
    const type = request.body.type?.trim();
    const enabled = request.body.enabled ?? true;
    const intervalMs = request.body.intervalMs;
    const cronExpr = request.body.cronExpr?.trim();

    if (!id || !type) {
      return reply.code(400).send({ ok: false, error: "id and type are required" });
    }

    if (intervalMs != null && cronExpr) {
      return reply.code(400).send({ ok: false, error: "provide either intervalMs or cronExpr" });
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
        return reply
          .code(400)
          .send({ ok: false, error: "intervalMs must be a positive number when cronExpr is not provided" });
      }

      const schedule = await app.automation.upsertIntervalSchedule({
        id,
        type,
        intervalMs: Math.floor(intervalMs),
        enabled,
      });
      return { ok: true, schedule };
    } catch (error) {
      return reply
        .code(400)
        .send({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  server.post<{ Params: { scheduleId: string } }>("/schedules/:scheduleId/pause", async (request, reply) => {
    const schedule = await app.automation.setScheduleEnabled(request.params.scheduleId, false);
    if (!schedule) {
      return reply.code(404).send({ ok: false, error: "schedule not found" });
    }
    return { ok: true, schedule };
  });

  server.post<{ Params: { scheduleId: string } }>("/schedules/:scheduleId/resume", async (request, reply) => {
    const schedule = await app.automation.setScheduleEnabled(request.params.scheduleId, true);
    if (!schedule) {
      return reply.code(404).send({ ok: false, error: "schedule not found" });
    }
    return { ok: true, schedule };
  });

  await server.listen({ host: app.config.host, port: app.config.port });
}
