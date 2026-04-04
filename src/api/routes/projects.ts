import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";
import type { ApiRouteDeps } from "../route-deps.js";

export function registerProjectRoutes(server: FastifyInstance, deps: ApiRouteDeps): void {
  const { app } = deps;

  server.get("/projects", async () => {
    const projects = await app.projects.listProjects();
    return { ok: true, projects };
  });

  server.get<{ Params: { project: string } }>("/projects/:project", async (request) => {
    const projectName = request.params.project?.trim();
    if (!projectName) {
      throw new ApiError(400, "BAD_REQUEST", "project is required");
    }
    const project = await app.projects.ensureProject(projectName);
    return {
      ok: true,
      project: {
        name: project.name,
        filePath: project.filePath,
        created: project.created,
        content: project.content,
        index: project.index,
      },
    };
  });

  server.get<{ Params: { project: string } }>("/projects/:project/documents", async (request) => {
    const projectName = request.params.project?.trim();
    if (!projectName) {
      throw new ApiError(400, "BAD_REQUEST", "project is required");
    }
    const documents = await app.projects.listDocuments(projectName);
    return { ok: true, documents };
  });

  server.get<{
    Params: { project: string };
    Querystring: { path?: string };
  }>("/projects/:project/document", async (request) => {
    const projectName = request.params.project?.trim();
    if (!projectName) {
      throw new ApiError(400, "BAD_REQUEST", "project is required");
    }
    const document = await app.projects.getDocument(projectName, request.query.path?.trim());
    if (!document) {
      throw new ApiError(404, "NOT_FOUND", "project document not found");
    }
    return { ok: true, document };
  });

  server.post<{
    Params: { project: string };
    Body: {
      path?: string;
      title?: string;
      description?: string;
      tags?: string[];
      content?: string;
      mode?: "replace" | "append";
    };
  }>("/projects/:project/documents", async (request) => {
    const projectName = request.params.project?.trim();
    const content = request.body.content?.trim();
    if (!projectName) {
      throw new ApiError(400, "BAD_REQUEST", "project is required");
    }
    if (!content) {
      throw new ApiError(400, "BAD_REQUEST", "content is required");
    }
    const document = await app.projects.upsertDocument({
      project: projectName,
      path: request.body.path?.trim() || undefined,
      title: request.body.title?.trim() || undefined,
      description: request.body.description?.trim() || undefined,
      tags: request.body.tags,
      content,
      mode: request.body.mode,
    });
    return { ok: true, document };
  });
}
