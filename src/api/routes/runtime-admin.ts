import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";
import type { ApiRouteDeps } from "../route-deps.js";

export function registerRuntimeAdminRoutes(server: FastifyInstance, deps: ApiRouteDeps): void {
  const { app, reconcilePlansNow } = deps;

  server.get<{ Querystring: { status?: string; limit?: string } }>(
    "/exec/approvals",
    async (request) => {
      const statusRaw = request.query.status?.trim().toLowerCase();
      const status =
        statusRaw === "open" ||
        statusRaw === "pending" ||
        statusRaw === "approved" ||
        statusRaw === "denied" ||
        statusRaw === "expired"
          ? statusRaw
          : undefined;
      const parsedLimit = Number(request.query.limit ?? "100");
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100;
      const approvals = await app.agent.runtimes.shell.listApprovals({ status, limit });
      return { ok: true, approvals };
    },
  );

  server.post<{ Params: { approvalId: string } }>(
    "/exec/approvals/:approvalId/approve",
    async (request) => {
      const approvalId = request.params.approvalId?.trim();
      if (!approvalId) {
        throw new ApiError(400, "BAD_REQUEST", "approvalId is required");
      }
      const approval = await app.agent.runtimes.shell.resolveApproval(approvalId, "approved");
      if (!approval) {
        throw new ApiError(404, "NOT_FOUND", "approval not found");
      }
      await reconcilePlansNow({ limit: 200 });
      return { ok: true, approval };
    },
  );

  server.post<{ Params: { approvalId: string } }>(
    "/exec/approvals/:approvalId/deny",
    async (request) => {
      const approvalId = request.params.approvalId?.trim();
      if (!approvalId) {
        throw new ApiError(400, "BAD_REQUEST", "approvalId is required");
      }
      const approval = await app.agent.runtimes.shell.resolveApproval(approvalId, "denied");
      if (!approval) {
        throw new ApiError(404, "NOT_FOUND", "approval not found");
      }
      await reconcilePlansNow({ limit: 200 });
      return { ok: true, approval };
    },
  );

  server.get<{ Querystring: { name?: string } }>(
    "/mcp/servers",
    async (request) => {
      const name = request.query.name?.trim();
      if (name) {
        const found = await app.agent.runtimes.mcp.getServer(name);
        return { ok: true, servers: found ? [found] : [] };
      }
      const servers = await app.agent.runtimes.mcp.listServers();
      return { ok: true, servers };
    },
  );

  server.post<{
    Body: {
      name?: string;
      transport?: string;
      target?: string;
      enabled?: boolean;
      requireApproval?: boolean;
      description?: string;
    };
  }>("/mcp/servers", async (request) => {
    const name = request.body.name?.trim();
    const transport = request.body.transport?.trim();
    const target = request.body.target?.trim();
    if (!name) {
      throw new ApiError(400, "BAD_REQUEST", "name is required");
    }
    if (transport !== "config" && transport !== "http" && transport !== "stdio") {
      throw new ApiError(400, "BAD_REQUEST", "transport must be config|http|stdio");
    }
    if (!target) {
      throw new ApiError(400, "BAD_REQUEST", "target is required");
    }
    const serverEntry = await app.agent.runtimes.mcp.upsertServer({
      name,
      transport,
      target,
      ...(typeof request.body.enabled === "boolean" ? { enabled: request.body.enabled } : {}),
      ...(typeof request.body.requireApproval === "boolean"
        ? { requireApproval: request.body.requireApproval }
        : {}),
      ...(request.body.description?.trim() ? { description: request.body.description.trim() } : {}),
    });
    return { ok: true, server: serverEntry };
  });

  server.get<{ Querystring: { status?: string; limit?: string } }>(
    "/mcp/approvals",
    async (request) => {
      const statusRaw = request.query.status?.trim().toLowerCase();
      const status =
        statusRaw === "open" ||
        statusRaw === "pending" ||
        statusRaw === "approved" ||
        statusRaw === "denied" ||
        statusRaw === "expired"
          ? statusRaw
          : undefined;
      const parsedLimit = Number(request.query.limit ?? "100");
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100;
      const approvals = await app.agent.runtimes.mcp.listApprovals({ status, limit });
      return { ok: true, approvals };
    },
  );

  server.post<{ Params: { approvalId: string } }>(
    "/mcp/approvals/:approvalId/approve",
    async (request) => {
      const approvalId = request.params.approvalId?.trim();
      if (!approvalId) {
        throw new ApiError(400, "BAD_REQUEST", "approvalId is required");
      }
      const approval = await app.agent.runtimes.mcp.resolveApproval(approvalId, "approved");
      if (!approval) {
        throw new ApiError(404, "NOT_FOUND", "approval not found");
      }
      return { ok: true, approval };
    },
  );

  server.post<{ Params: { approvalId: string } }>(
    "/mcp/approvals/:approvalId/deny",
    async (request) => {
      const approvalId = request.params.approvalId?.trim();
      if (!approvalId) {
        throw new ApiError(400, "BAD_REQUEST", "approvalId is required");
      }
      const approval = await app.agent.runtimes.mcp.resolveApproval(approvalId, "denied");
      if (!approval) {
        throw new ApiError(404, "NOT_FOUND", "approval not found");
      }
      return { ok: true, approval };
    },
  );

  server.get<{ Querystring: { status?: string; limit?: string } }>(
    "/exec/sessions",
    async (request) => {
      const list = await app.agent.runtimes.shell.process({
        sessionKey: "api.exec.sessions",
        action: "list",
      });
      if (!list.ok) {
        throw new ApiError(500, "INTERNAL_ERROR", list.message ?? "failed to list exec sessions");
      }

      const status = request.query.status?.trim().toLowerCase();
      const parsedLimit = Number(request.query.limit ?? "100");
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 100;
      const filtered =
        status && status !== "all"
          ? (list.sessions ?? []).filter((session) => session.status.toLowerCase() === status)
          : list.sessions ?? [];
      return { ok: true, sessions: filtered.slice(0, limit) };
    },
  );

  server.get<{ Params: { sessionId: string }; Querystring: { offset?: string; limit?: string } }>(
    "/exec/sessions/:sessionId/log",
    async (request) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        throw new ApiError(400, "BAD_REQUEST", "sessionId is required");
      }
      const offsetRaw = Number(request.query.offset ?? "0");
      const limitRaw = Number(request.query.limit ?? "8000");
      const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 8000;

      const result = await app.agent.runtimes.shell.process({
        sessionKey: "api.exec.sessions",
        action: "log",
        sessionId,
        offset,
        limit,
      });

      if (!result.ok || !result.session) {
        throw new ApiError(404, "NOT_FOUND", result.message ?? "session not found");
      }

      return {
        ok: true,
        session: result.session,
        output: result.output ?? "",
        page: result.message ?? "",
      };
    },
  );
}
