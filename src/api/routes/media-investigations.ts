import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";
import type { ApiRouteDeps } from "../route-deps.js";

export function registerMediaInvestigationRoutes(server: FastifyInstance, deps: ApiRouteDeps): void {
  const investigations = deps.app.agent.video.investigations;

  server.get<{
    Querystring: { limit?: string };
  }>("/media-investigations", async (request) => {
    const limit = Number(request.query.limit ?? "100");
    return {
      ok: true,
      agentsAvailable: investigations.agentsAvailable,
      investigations: investigations.list(Number.isFinite(limit) ? limit : 100),
    };
  });

  server.get<{
    Params: { id: string };
  }>("/media-investigations/:id", async (request) => {
    const investigation = investigations.get(request.params.id);
    if (!investigation) {
      throw new ApiError(404, "NOT_FOUND", `Media investigation ${request.params.id} not found`);
    }
    return { ok: true, investigation };
  });

  server.post<{
    Body: {
      originId?: string;
      problemStatement?: string;
      problemContext?: {
        approximateTime?: string;
        affectedTrack?: "audio" | "video" | "both" | "unknown";
        player?: string;
        reproducibility?: string;
        expectedBehavior?: string;
      };
      fullAnalysis?: boolean;
    };
  }>("/media-investigations", async (request) => {
    const originId = request.body?.originId?.trim();
    if (!originId) {
      throw new ApiError(400, "BAD_REQUEST", "originId is required");
    }
    if (!investigations.agentsAvailable) {
      throw new ApiError(409, "BAD_REQUEST", "Configure KAEL_PI_API_KEY to run media investigation agents");
    }
    const origins = await deps.app.agent.video.streamer.listOrigins();
    if (!origins.some((origin) => origin.id === originId)) {
      throw new ApiError(404, "NOT_FOUND", `Origin ${originId} not found`);
    }
    const investigation = await investigations.start({
      originId,
      problemStatement: request.body.problemStatement,
      problemContext: request.body.problemContext,
      fullAnalysis: request.body.fullAnalysis ?? true,
    });
    return { ok: true, investigation };
  });

  server.post<{
    Params: { id: string };
  }>("/media-investigations/:id/rerun", async (request) => {
    if (!investigations.get(request.params.id)) {
      throw new ApiError(404, "NOT_FOUND", `Media investigation ${request.params.id} not found`);
    }
    const investigation = await investigations.rerun(request.params.id);
    return { ok: true, investigation };
  });
}
