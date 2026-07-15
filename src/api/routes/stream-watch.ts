import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";
import type { ApiRouteDeps } from "../route-deps.js";

export function registerStreamWatchRoutes(server: FastifyInstance, deps: ApiRouteDeps): void {
  const { app } = deps;

  // POST /streams/watch — inicia uma sessão de monitoramento
  server.post<{
    Body: {
      sessionKey?: string;
      url?: string;
      pollIntervalMs?: number;
      maxPollCount?: number;
      timeoutMs?: number;
    };
  }>("/streams/watch", async (request) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const url = request.body.url?.trim();

    if (!url) {
      throw new ApiError(400, "BAD_REQUEST", "url is required");
    }

    const id = app.agent.video.streamMonitor.startWatch({
      sessionKey,
      url,
      pollIntervalMs: request.body.pollIntervalMs,
      maxPollCount: request.body.maxPollCount,
      timeoutMs: request.body.timeoutMs,
    });

    const status = app.agent.video.streamMonitor.getStatus(id);
    return { ok: true, watchId: id, status };
  });

  // GET /streams/watch — lista todas as sessões
  server.get("/streams/watch", async () => {
    const watches = app.agent.video.streamMonitor.listWatches();
    return { ok: true, watches };
  });

  // GET /streams/watch/:id — status de uma sessão específica
  server.get<{
    Params: { id: string };
  }>("/streams/watch/:id", async (request) => {
    const status = app.agent.video.streamMonitor.getStatus(request.params.id);
    if (!status) {
      throw new ApiError(404, "NOT_FOUND", `Watch session ${request.params.id} not found`);
    }
    return { ok: true, status };
  });

  // DELETE /streams/watch/:id — para uma sessão
  server.delete<{
    Params: { id: string };
  }>("/streams/watch/:id", async (request) => {
    const stopped = app.agent.video.streamMonitor.stopWatch(request.params.id);
    if (!stopped) {
      throw new ApiError(404, "NOT_FOUND", `Watch session ${request.params.id} not found`);
    }
    const status = app.agent.video.streamMonitor.getStatus(request.params.id);
    return { ok: true, stopped: true, status };
  });
}
