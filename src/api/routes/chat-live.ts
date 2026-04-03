import type { FastifyInstance } from "fastify";
import { IdempotencyConflictError, stableStringify } from "../../infra/idempotency-store.js";
import { kaelLogger } from "../../infra/logger.js";
import { ApiError } from "../errors.js";
import { buildLiveState, type LivePingEvent, type LiveResource, type LiveSyncEvent } from "../live-state.js";
import { normalizeInboundAttachments, readIdempotencyKey, withIdempotency } from "../request-utils.js";
import type { ApiRouteDeps } from "../route-deps.js";

export function registerChatAndLiveRoutes(server: FastifyInstance, deps: ApiRouteDeps): void {
  const { app, idempotency } = deps;

  server.get("/health", async () => {
    const version = process.env.npm_package_version ?? "0.1.0";
    const sessions = await app.sessions.countSessions();
    const schedules = app.automation.listSchedules();
    const jobsByStatus = app.jobs.getStatusCounts();
    const runtimeJobs = app.jobs.getRuntimeStats();
    const chatRouting = app.chat.getRoutingTelemetrySnapshot();
    const engineRuntime = app.chat.getEngineRuntimeTelemetrySnapshot();
    const mediaRuntime = app.chat.getMediaRuntimeTelemetrySnapshot();
    const browserRuntime = app.chat.getBrowserRuntimeTelemetrySnapshot();
    const skillsRuntime = app.chat.getSkillsRuntimeTelemetrySnapshot();
    const mcpRuntime = app.mcp.getRuntimeTelemetrySnapshot();
    const emailIngest = app.emailIngest?.getRuntimeTelemetrySnapshot() ?? null;

    return {
      ok: true,
      service: "kael",
      status: "ok",
      version,
      now: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      engineMode: app.config.engineMode,
      piEnabled: app.config.pi.enabled,
      metrics: {
        sessions,
        totalJobs: Object.values(jobsByStatus).reduce<number>((sum, value) => sum + Number(value), 0),
        jobsByStatus,
        schedules: {
          total: schedules.length,
          enabled: schedules.filter((schedule) => schedule.enabled).length,
        },
        runtimeJobs,
        chatRouting,
        engineRuntime,
        mediaRuntime,
        browserRuntime,
        skillsRuntime,
        mcpRuntime,
        emailIngest,
        edgeRuntime: {
          connectedClients: app.edge.listClients().length,
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

    writeSync(
      ["health", "jobs", "schedules", "plans", "approvals", "exec_sessions", "mcp_servers", "mcp_approvals"],
      previous.summary,
    );

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
}
