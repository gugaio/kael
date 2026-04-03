import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";
import type { ApiRouteDeps } from "../route-deps.js";
import { createPlannerExecuteRuntime, createPlannerReconcileRuntime } from "../../planner/runtime.js";

export function registerPlanRoutes(server: FastifyInstance, deps: ApiRouteDeps): void {
  const { app, reconcilePlansNow } = deps;
  const plannerExecuteRuntime = createPlannerExecuteRuntime(app);
  const plannerReconcileRuntime = createPlannerReconcileRuntime(app);

  server.get<{
    Querystring: {
      sessionKey?: string;
      status?: string;
      limit?: string;
    };
  }>("/plans", async (request) => {
    const statusRaw = request.query.status?.trim().toLowerCase();
    const status =
      statusRaw === "active" ||
      statusRaw === "completed" ||
      statusRaw === "blocked" ||
      statusRaw === "failed" ||
      statusRaw === "canceled"
        ? statusRaw
        : undefined;
    const parsedLimit = Number(request.query.limit ?? "50");
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
    const plans = app.planner.list({
      sessionKey: request.query.sessionKey?.trim(),
      status,
      limit,
    });
    return { ok: true, plans };
  });

  server.get<{ Params: { planId: string } }>("/plans/:planId", async (request) => {
    const planId = request.params.planId?.trim();
    if (!planId) {
      throw new ApiError(400, "BAD_REQUEST", "planId is required");
    }
    const plan = app.planner.get(planId);
    if (!plan) {
      throw new ApiError(404, "NOT_FOUND", `plan ${planId} not found`);
    }
    return { ok: true, plan };
  });

  server.post<{
    Body: {
      sessionKey?: string;
      title?: string;
      steps?: string[];
    };
  }>("/plans", async (request) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const title = request.body.title?.trim() || "Plano de execucao";
    const steps = Array.isArray(request.body.steps) ? request.body.steps : [];
    const plan = await app.planner.create({ sessionKey, title, steps });
    return { ok: true, plan };
  });

  server.post<{
    Body: {
      sessionKey?: string;
      objective?: string;
      maxSteps?: number;
    };
  }>("/plans/generate", async (request) => {
    const sessionKey = request.body.sessionKey?.trim() || "main";
    const objective = request.body.objective?.trim();
    if (!objective) {
      throw new ApiError(400, "BAD_REQUEST", "objective is required");
    }
    const maxStepsRaw = Number(request.body.maxSteps);
    const maxSteps = Number.isFinite(maxStepsRaw) && maxStepsRaw > 0 ? Math.floor(maxStepsRaw) : undefined;
    const plan = await app.planner.generate({
      sessionKey,
      objective,
      maxSteps,
    });
    return { ok: true, plan };
  });

  server.post<{
    Params: { planId: string; stepIndex: string };
    Body: {
      status?: string;
      notes?: string;
    };
  }>("/plans/:planId/steps/:stepIndex", async (request) => {
    const planId = request.params.planId?.trim();
    const stepIndex = Number(request.params.stepIndex);
    const statusRaw = request.body.status?.trim().toLowerCase();
    const status =
      statusRaw === "pending" ||
      statusRaw === "in_progress" ||
      statusRaw === "completed" ||
      statusRaw === "blocked" ||
      statusRaw === "failed" ||
      statusRaw === "canceled"
        ? statusRaw
        : null;
    if (!planId) {
      throw new ApiError(400, "BAD_REQUEST", "planId is required");
    }
    if (!Number.isFinite(stepIndex) || stepIndex < 0) {
      throw new ApiError(400, "BAD_REQUEST", "stepIndex must be a non-negative number");
    }
    if (!status) {
      throw new ApiError(400, "BAD_REQUEST", "valid step status is required");
    }

    const plan = await app.planner.updateStep({
      planId,
      stepIndex: Math.floor(stepIndex),
      status,
      notes: request.body.notes,
    });
    if (!plan) {
      throw new ApiError(404, "NOT_FOUND", "plan/step not found");
    }
    return { ok: true, plan };
  });

  server.post<{
    Params: { planId: string };
    Body: {
      sessionKey?: string;
      inputs?: {
        inputPath?: string;
        outputPath?: string;
        outputPlaylistPath?: string;
        streamUrl?: string;
        durationSeconds?: number;
        segmentTime?: number;
        args?: string[];
        command?: string;
        cwd?: string;
        timeoutMs?: number;
        background?: boolean;
        targetStepIndex?: number;
      };
    };
  }>("/plans/:planId/execute-next", async (request) => {
    const planId = request.params.planId?.trim();
    if (!planId) {
      throw new ApiError(400, "BAD_REQUEST", "planId is required");
    }
    const result = await app.planner.executeNext({
      planId,
      sessionKey: request.body.sessionKey?.trim(),
      inputs: request.body.inputs,
      runtime: plannerExecuteRuntime,
    });

    await reconcilePlansNow({ planId, limit: 1 });

    return result;
  });

  server.post<{
    Params: { planId: string };
    Body: {
      note?: string;
    };
  }>("/plans/:planId/cancel", async (request) => {
    const planId = request.params.planId?.trim();
    if (!planId) {
      throw new ApiError(400, "BAD_REQUEST", "planId is required");
    }
    const plan = await app.planner.cancelPlan({
      planId,
      note: request.body.note,
    });
    if (!plan) {
      throw new ApiError(404, "NOT_FOUND", `plan ${planId} not found`);
    }
    return { ok: true, plan };
  });

  server.post<{
    Body: {
      planId?: string;
      limit?: number;
    };
  }>("/plans/reconcile", async (request) => {
    const planId = request.body.planId?.trim();
    const limitRaw = Number(request.body.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined;
    const result = await app.planner.reconcile({
      planId,
      limit,
      runtime: plannerReconcileRuntime,
    });
    return { ok: true, ...result };
  });
}
