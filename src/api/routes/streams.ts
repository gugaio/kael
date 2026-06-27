import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";
import type { ApiRouteDeps } from "../route-deps.js";

export function registerStreamRoutes(server: FastifyInstance, deps: ApiRouteDeps): void {
  const { app } = deps;

  server.get("/streams", async () => {
    const origins = await app.streamer.listOrigins();
    const serving = app.serveManager.listServing();
    const servingMap = new Map(serving.map((s) => [s.originId, s]));
    const items = origins.map((o) => ({
      ...o,
      serving: servingMap.has(o.id),
      servingUrl: servingMap.get(o.id)?.playbackUrl ?? null,
    }));
    return { ok: true, streams: items };
  });

  server.get<{
    Params: { originId: string };
  }>("/streams/:originId", async (request) => {
    const origin = await app.streamer.inspectOrigin(request.params.originId);
    const active = app.serveManager.listServing().find((s) => s.originId === request.params.originId);
    return { ok: true, stream: { ...origin, serving: !!active, servingUrl: active?.playbackUrl ?? null } };
  });

  server.post<{
    Body: {
      url: string;
      originId?: string;
      durationSeconds?: number;
      allVariants?: boolean;
      format?: "auto" | "hls" | "dash";
    };
  }>("/streams/clone", async (request) => {
    const url = request.body.url?.trim();
    if (!url) {
      throw new ApiError(400, "BAD_REQUEST", "url is required");
    }
    const format = request.body.format ?? "auto";
    if (format !== "auto" && format !== "hls" && format !== "dash") {
      throw new ApiError(400, "BAD_REQUEST", "format must be auto, hls, or dash");
    }
    const input = {
      url,
      format,
      ...(request.body.originId?.trim() ? { originId: request.body.originId.trim() } : {}),
      ...(request.body.durationSeconds != null && Number.isFinite(request.body.durationSeconds)
        ? { durationSeconds: request.body.durationSeconds }
        : {}),
      ...(request.body.allVariants ? { allVariants: true } : {}),
    };
    const resolvedFormat = resolveFormat(url, format);
    const result = resolvedFormat === "dash"
      ? await app.streamer.cloneDash(input)
      : await app.streamer.cloneHls(input);
    return { ok: true, stream: result };
  });

  server.post<{
    Params: { originId: string };
  }>("/streams/:originId/serve", async (request) => {
    const { originId } = request.params;
    const origins = await app.streamer.listOrigins();
    if (!origins.some((o) => o.id === originId)) {
      throw new ApiError(404, "NOT_FOUND", `Origin ${originId} not found`);
    }
    const active = await app.serveManager.serve(originId);
    return { ok: true, serve: active };
  });

  server.post<{
    Params: { originId: string };
  }>("/streams/:originId/stop", async (request) => {
    const stopped = await app.serveManager.stop(request.params.originId);
    if (!stopped) {
      throw new ApiError(404, "NOT_FOUND", `Origin ${request.params.originId} is not serving`);
    }
    return { ok: true, stopped: true };
  });

  server.delete<{
    Params: { originId: string };
  }>("/streams/:originId", async (request) => {
    const { originId } = request.params;
    const origins = await app.streamer.listOrigins();
    if (!origins.some((o) => o.id === originId)) {
      throw new ApiError(404, "NOT_FOUND", `Origin ${originId} not found`);
    }
    await app.serveManager.stop(originId);
    const result = await app.streamer.removeOrigin(originId);
    return { ok: true, removed: result };
  });
}

function resolveFormat(url: string, format: "auto" | "hls" | "dash"): "hls" | "dash" {
  if (format === "hls" || format === "dash") {
    return format;
  }
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".mpd") ? "dash" : "hls";
  } catch {
    return "hls";
  }
}
