import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import { ApiError } from "../errors.js";
import type { ApiRouteDeps } from "../route-deps.js";

export function registerStreamWatchRoutes(server: FastifyInstance, deps: ApiRouteDeps): void {
  const { app } = deps;

  // POST /streams/watch — inicia uma sessão de monitoramento
  server.post<{
    Body: {
      sessionKey?: string;
      url?: string;
      profile?: "manifest" | "chunks" | "full";
      mode?: "auto" | "vod" | "live";
      pollIntervalMs?: number;
      maxPollCount?: number;
      timeoutMs?: number;
      maxDurationMs?: number;
      retentionHours?: number;
      variantSelector?: string;
      allVariants?: boolean;
    };
  }>("/streams/watch", async (request) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const url = request.body.url?.trim();

    if (!url) {
      throw new ApiError(400, "BAD_REQUEST", "url is required");
    }

    const id = app.streamMonitor.startWatch({
      sessionKey,
      url,
      profile: request.body.profile,
      mode: request.body.mode,
      pollIntervalMs: request.body.pollIntervalMs,
      maxPollCount: request.body.maxPollCount,
      timeoutMs: request.body.timeoutMs,
      maxDurationMs: request.body.maxDurationMs,
      retentionHours: request.body.retentionHours,
      variantSelector: request.body.variantSelector,
      allVariants: request.body.allVariants,
    });

    const status = app.streamMonitor.getStatus(id);
    return { ok: true, watchId: id, status };
  });

  // GET /streams/watch — lista todas as sessões
  server.get("/streams/watch", async () => {
    const watches = app.streamMonitor.listWatches();
    return { ok: true, watches };
  });

  // GET /streams/watch/:id — status de uma sessão específica
  server.get<{
    Params: { id: string };
  }>("/streams/watch/:id", async (request) => {
    const status = app.streamMonitor.getStatus(request.params.id);
    if (!status) {
      throw new ApiError(404, "NOT_FOUND", `Watch session ${request.params.id} not found`);
    }
    return { ok: true, status };
  });

  // POST /streams/watch/:id/stop — para uma sessão
  server.post<{
    Params: { id: string };
  }>("/streams/watch/:id/stop", async (request) => {
    const stopped = app.streamMonitor.stopWatch(request.params.id);
    if (!stopped) {
      throw new ApiError(404, "NOT_FOUND", `Watch session ${request.params.id} not found`);
    }
    const status = app.streamMonitor.getStatus(request.params.id);
    return { ok: true, stopped: true, status };
  });

  // GET /streams/watch/:id/report — retorna o report JSON quando disponível
  server.get<{
    Params: { id: string };
  }>("/streams/watch/:id/report", async (request) => {
    const status = app.streamMonitor.getStatus(request.params.id);
    if (!status) {
      throw new ApiError(404, "NOT_FOUND", `Watch session ${request.params.id} not found`);
    }
    if (!status.report?.jsonPath) {
      throw new ApiError(404, "NOT_FOUND", `Watch session ${request.params.id} has no report yet`);
    }
    const raw = await fs.readFile(status.report.jsonPath, "utf-8");
    return { ok: true, report: JSON.parse(raw) };
  });

  server.get<{
    Params: { id: string };
  }>("/streams/watch/:id/report.html", async (request, reply) => {
    const status = app.streamMonitor.getStatus(request.params.id);
    if (!status) {
      throw new ApiError(404, "NOT_FOUND", `Watch session ${request.params.id} not found`);
    }
    if (!status.report?.htmlPath) {
      throw new ApiError(404, "NOT_FOUND", `Watch session ${request.params.id} has no HTML report yet`);
    }
    const raw = await fs.readFile(status.report.htmlPath, "utf-8");
    reply.type("text/html");
    return raw;
  });

  // DELETE /streams/watch/:id — remove uma sessão persistida e seus artefatos
  server.delete<{
    Params: { id: string };
  }>("/streams/watch/:id", async (request) => {
    const removed = await app.streamMonitor.removeWatch(request.params.id);
    if (!removed) {
      throw new ApiError(404, "NOT_FOUND", `Watch session ${request.params.id} not found`);
    }
    return { ok: true, removed: true };
  });
}
