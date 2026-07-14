import type { FastifyInstance } from "fastify";
import os from "node:os";
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
      networkServingUrl: toNetworkPlaybackUrl(servingMap.get(o.id)?.playbackUrl) ?? null,
    }));
    return { ok: true, streams: items };
  });

  server.get<{
    Params: { originId: string };
  }>("/streams/:originId", async (request) => {
    const origin = await app.streamer.inspectOrigin(request.params.originId);
    const active = app.serveManager.listServing().find((s) => s.originId === request.params.originId);
    return {
      ok: true,
      stream: {
        ...origin,
        serving: !!active,
        servingUrl: active?.playbackUrl ?? null,
        networkServingUrl: toNetworkPlaybackUrl(active?.playbackUrl) ?? null,
      },
    };
  });

  server.post<{
    Params: { originId: string };
    Body: {
      timeoutMs?: number;
      maxMediaPlaylists?: number;
    };
  }>("/streams/:originId/probe", async (request) => {
    const report = await app.streamer.probeOrigin(request.params.originId, {
      ...(request.body?.timeoutMs != null && Number.isFinite(request.body.timeoutMs)
        ? { timeoutMs: request.body.timeoutMs }
        : {}),
      ...(request.body?.maxMediaPlaylists != null && Number.isFinite(request.body.maxMediaPlaylists)
        ? { maxMediaPlaylists: request.body.maxMediaPlaylists }
        : {}),
    });
    return { ok: true, report };
  });

  server.post<{
    Params: { originId: string };
    Body: {
      timeoutMs?: number;
      maxMediaPlaylists?: number;
      maxSegmentsPerPlaylist?: number;
      startSegment?: number;
      segmentCount?: number;
      full?: boolean;
    };
  }>("/streams/:originId/analyze", async (request) => {
    const report = await app.streamer.analyzeOrigin(request.params.originId, {
      ...(request.body?.timeoutMs != null && Number.isFinite(request.body.timeoutMs)
        ? { timeoutMs: request.body.timeoutMs }
        : {}),
      ...(request.body?.maxMediaPlaylists != null && Number.isFinite(request.body.maxMediaPlaylists)
        ? { maxMediaPlaylists: request.body.maxMediaPlaylists }
        : {}),
      ...(request.body?.maxSegmentsPerPlaylist != null && Number.isFinite(request.body.maxSegmentsPerPlaylist)
        ? { maxSegmentsPerPlaylist: request.body.maxSegmentsPerPlaylist }
        : {}),
      ...(request.body?.startSegment != null && Number.isFinite(request.body.startSegment)
        ? { startSegment: request.body.startSegment }
        : {}),
      ...(request.body?.segmentCount != null && Number.isFinite(request.body.segmentCount)
        ? { segmentCount: request.body.segmentCount }
        : {}),
      ...(request.body?.full ? { full: true } : {}),
    });
    return { ok: true, report };
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
    Body: {
      host?: string;
    };
  }>("/streams/:originId/serve", async (request) => {
    const { originId } = request.params;
    const origins = await app.streamer.listOrigins();
    if (!origins.some((o) => o.id === originId)) {
      throw new ApiError(404, "NOT_FOUND", `Origin ${originId} not found`);
    }
    const host = normalizeServeHost(request.body?.host);
    const active = await app.serveManager.serve(originId, host ? { host } : undefined);
    return {
      ok: true,
      serve: {
        ...active,
        networkPlaybackUrl: toNetworkPlaybackUrl(active.playbackUrl) ?? null,
      },
    };
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

function normalizeServeHost(value: string | undefined): string | undefined {
  const host = value?.trim();
  if (!host) return undefined;
  if (host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0") {
    return host;
  }
  throw new ApiError(400, "BAD_REQUEST", "host must be 127.0.0.1, localhost, or 0.0.0.0");
}

function toNetworkPlaybackUrl(playbackUrl: string | undefined): string | undefined {
  if (!playbackUrl) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(playbackUrl);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== "0.0.0.0" && parsed.hostname !== "::") {
    return undefined;
  }
  const lanHost = getFirstLanIpv4();
  if (!lanHost) return undefined;
  parsed.hostname = lanHost;
  return parsed.toString();
}

function getFirstLanIpv4(): string | undefined {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return undefined;
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
