import type { FastifyInstance } from "fastify";
import { IdempotencyConflictError, stableStringify } from "../../infra/idempotency-store.js";
import { ApiError } from "../errors.js";
import { readIdempotencyKey, withIdempotency } from "../request-utils.js";
import type { ApiRouteDeps } from "../route-deps.js";

export function registerJobAndScheduleRoutes(server: FastifyInstance, deps: ApiRouteDeps): void {
  const { app, idempotency } = deps;

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
          const job = await app.agent.video.ffmpeg.startTranscode({
            sessionKey,
            inputPath,
            outputPath,
            args,
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
          const job = await app.agent.video.ffmpeg.startPlayVlc({ sessionKey, input });
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
          const job = await app.agent.video.ffmpeg.startConvertHls({
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
          const job = await app.agent.video.ffmpeg.startCaptureStream({
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

  server.get("/jobs", async () => ({ ok: true, jobs: app.agent.video.jobs.listJobs() }));

  server.get<{ Params: { jobId: string } }>("/jobs/:jobId", async (request) => {
    const job = app.agent.video.jobs.getJob(request.params.jobId);
    if (!job) {
      throw new ApiError(404, "NOT_FOUND", "job not found");
    }
    return { ok: true, job };
  });

  server.get<{ Params: { jobId: string } }>("/jobs/:jobId/log", async (request) => {
    const log = await app.agent.video.jobs.getJobLog(request.params.jobId);
    if (log === null) {
      throw new ApiError(404, "NOT_FOUND", "job not found");
    }
    return { ok: true, log };
  });

  server.post<{ Params: { jobId: string } }>("/jobs/:jobId/cancel", async (request) => {
    const result = await app.agent.video.jobs.cancelJob(request.params.jobId);
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
}
