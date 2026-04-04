import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";
import type { ApiRouteDeps } from "../route-deps.js";

export function registerKnowledgeRoutes(server: FastifyInstance, deps: ApiRouteDeps): void {
  const { app } = deps;

  server.get<{
    Querystring: {
      query?: string;
      project?: string;
      tag?: string;
      status?: "draft" | "curated" | "stale" | "conflicting";
      limit?: string;
    };
  }>("/knowledge/search", async (request) => {
    const query = request.query.query?.trim();
    if (!query) {
      throw new ApiError(400, "BAD_REQUEST", "query is required");
    }
    const limitRaw = Number(request.query.limit ?? "6");
    const maxResults = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 6;
    const results = await app.knowledgeBase.search({
      query,
      project: request.query.project?.trim() || undefined,
      tag: request.query.tag?.trim() || undefined,
      status: request.query.status,
      maxResults,
    });
    return { ok: true, results };
  });

  server.get<{ Params: { noteId: string } }>("/knowledge/notes/:noteId", async (request) => {
    const noteId = request.params.noteId?.trim();
    if (!noteId) {
      throw new ApiError(400, "BAD_REQUEST", "noteId is required");
    }
    const note = await app.knowledgeBase.get(noteId);
    if (!note) {
      throw new ApiError(404, "NOT_FOUND", "knowledge note not found");
    }
    return { ok: true, note };
  });

  server.post<{
    Body: {
      noteId?: string;
      project?: string;
      topic?: string;
      title?: string;
      question?: string;
      answer?: string;
      summary?: string;
      tags?: string[];
      files?: string[];
      evidence?: string[];
      status?: "draft" | "curated" | "stale" | "conflicting";
      confidence?: number;
      updatedBy?: string;
      source?: string;
    };
  }>("/knowledge/notes", async (request) => {
    const project = request.body.project?.trim();
    const topic = request.body.topic?.trim();
    const answer = request.body.answer?.trim();
    if (!project) {
      throw new ApiError(400, "BAD_REQUEST", "project is required");
    }
    if (!topic) {
      throw new ApiError(400, "BAD_REQUEST", "topic is required");
    }
    if (!answer) {
      throw new ApiError(400, "BAD_REQUEST", "answer is required");
    }
    const note = await app.knowledgeBase.upsert({
      noteId: request.body.noteId?.trim() || undefined,
      project,
      topic,
      title: request.body.title?.trim() || undefined,
      question: request.body.question?.trim() || undefined,
      answer,
      summary: request.body.summary?.trim() || undefined,
      tags: request.body.tags,
      files: request.body.files,
      evidence: request.body.evidence,
      status: request.body.status,
      confidence: request.body.confidence,
      updatedBy: request.body.updatedBy?.trim() || undefined,
      source: request.body.source?.trim() || undefined,
    });
    return { ok: true, note };
  });
}
