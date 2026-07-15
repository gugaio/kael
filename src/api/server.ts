import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { createKaelApp, type KaelApp } from "../app.js";
import { IdempotencyStore } from "../infra/idempotency-store.js";
import { kaelLogger } from "../infra/logger.js";
import { ApiError, asApiError, sendApiError } from "./errors.js";
import { registerEdgeWsGateway } from "./edge-ws.js";
import type { RequestWithStart } from "./route-deps.js";
import { registerChatAndLiveRoutes } from "./routes/chat-live.js";
import { registerJobAndScheduleRoutes } from "./routes/jobs-schedules.js";
import { registerPlanRoutes } from "./routes/plans.js";
import { registerRuntimeAdminRoutes } from "./routes/runtime-admin.js";
import { registerStreamRoutes } from "./routes/streams.js";
import { registerStreamWatchRoutes } from "./routes/stream-watch.js";

export function createApiServer(app: KaelApp): FastifyInstance {
  const server = Fastify({ logger: false });
  const idempotency = new IdempotencyStore(app.config.idempotency.ttlMs);

  const reconcilePlansNow = async (params?: { planId?: string; limit?: number }): Promise<void> => {
    try {
      await app.agent.services.planner.reconcile({
        planId: params?.planId,
        limit: params?.limit,
        runtime: {
          getJob: async (jobId: string) => {
            const found = app.agent.video.jobs.getJob(jobId);
            if (!found) {
              return null;
            }
            return {
              status: found.status,
              error: found.error,
            };
          },
          pollExec: async (sessionId: string) => {
            const result = await app.agent.runtimes.shell.process({
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
    } catch (error) {
      kaelLogger.warn("planner.reconcile.on_demand_failed", {
        planId: params?.planId ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  registerEdgeWsGateway(server, app);

  server.addHook("onRequest", async (request) => {
    (request as RequestWithStart)._kaelStartNs = process.hrtime.bigint();
    if (!isAuthorized(request.headers.authorization, app.config.api.authToken)) {
      throw new ApiError(401, "UNAUTHORIZED", "Unauthorized");
    }
  });

  server.addHook("onResponse", async (request, reply) => {
    const startNs = (request as RequestWithStart)._kaelStartNs;
    const durationMs = startNs != null ? Number(process.hrtime.bigint() - startNs) / 1_000_000 : undefined;
    kaelLogger.info("api.request", {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url,
      status: reply.statusCode,
      durationMs: durationMs != null ? Math.round(durationMs) : undefined,
      sessionKey:
        request.method === "POST" && request.body && typeof request.body === "object"
          ? ((request.body as { sessionKey?: unknown }).sessionKey ?? null)
          : null,
    });
  });

  server.setErrorHandler((error, request, reply) => {
    const apiError = asApiError(error);
    const cause = apiError.cause ?? error;
    const causeMessage = cause instanceof Error ? cause.message : cause != null ? String(cause) : undefined;
    const causeStack = cause instanceof Error ? cause.stack : undefined;
    const causeName = cause instanceof Error ? cause.name : undefined;
    kaelLogger.error("api.request.error", {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url,
      status: apiError.status,
      code: apiError.code,
      message: apiError.message,
      // Real underlying failure (lost before): surfaced for 5xx debugging.
      causeName: causeName ?? null,
      causeMessage: causeMessage ?? null,
      stack: causeStack ?? null,
    });
    sendApiError(reply, request, apiError);
  });

  const deps = {
    app,
    idempotency,
    reconcilePlansNow,
  };

  registerChatAndLiveRoutes(server, deps);
  registerPlanRoutes(server, deps);
  registerRuntimeAdminRoutes(server, deps);
  registerJobAndScheduleRoutes(server, deps);
  registerStreamRoutes(server, deps);
  registerStreamWatchRoutes(server, deps);

  return server;
}

function isAuthorized(authorization: string | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken) {
    return true;
  }
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return false;
  }
  const actualToken = Buffer.from(match[1]);
  const configuredToken = Buffer.from(expectedToken);
  return actualToken.length === configuredToken.length && timingSafeEqual(actualToken, configuredToken);
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
