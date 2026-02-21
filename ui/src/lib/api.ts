import { z } from "zod";

const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    status: z.number(),
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

const JobSchema = z.object({
  id: z.string(),
  type: z.string(),
  sessionKey: z.string(),
  status: z.string(),
  input: z.string(),
  output: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  error: z.string().optional(),
});

const ScheduleSchema = z.object({
  id: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  nextRunAt: z.string(),
  schedule: z.union([
    z.object({ kind: z.literal("interval"), intervalMs: z.number() }),
    z.object({ kind: z.literal("cron"), cronExpr: z.string() }),
  ]),
});

const HealthSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  version: z.string(),
  now: z.string(),
  uptimeSec: z.number(),
  engineMode: z.string(),
  piEnabled: z.boolean(),
  metrics: z.object({
    sessions: z.number(),
    totalJobs: z.number(),
    jobsByStatus: z.record(z.string(), z.number()),
    runtimeJobs: z.object({
      activeJobs: z.number(),
      queuedJobs: z.number(),
      maxConcurrentJobs: z.number(),
    }),
    schedules: z.object({
      total: z.number(),
      enabled: z.number(),
      disabled: z.number(),
    }),
  }),
});

const MessagesSchema = z.object({
  ok: z.boolean(),
  messages: z.array(
    z.object({
      id: z.string(),
      sessionKey: z.string(),
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
      createdAt: z.string(),
    }),
  ),
});

const PlanStepCheckpointSchema = z.object({
  at: z.string(),
  status: z.string(),
  notes: z.string().optional(),
});

const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  notes: z.string().optional(),
  updatedAt: z.string(),
  checkpoints: z.array(PlanStepCheckpointSchema).optional(),
  execution: z
    .object({
      kind: z.enum(["job", "exec"]),
      refId: z.string(),
      status: z.string(),
      startedAt: z.string(),
      command: z.string().optional(),
    })
    .optional(),
});

const PlanSchema = z.object({
  id: z.string(),
  sessionKey: z.string(),
  title: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  steps: z.array(PlanStepSchema),
});

async function parseJson<T>(response: Response, schema: z.ZodSchema<T>): Promise<T> {
  const raw = await response.json();
  if (!response.ok) {
    const err = ApiErrorSchema.safeParse(raw);
    if (err.success) {
      throw new Error(err.data.error.message);
    }
    throw new Error(`Request failed with status ${String(response.status)}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid API response");
  }
  return parsed.data;
}

export type Job = z.infer<typeof JobSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Health = z.infer<typeof HealthSchema>;
export type Message = z.infer<typeof MessagesSchema>["messages"][number];
export type Plan = z.infer<typeof PlanSchema>;
export type ExecApproval = {
  id: string;
  command: string;
  cwd: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "denied" | "expired";
  decidedAt?: string;
};

export async function getHealth(): Promise<Health> {
  const response = await fetch("/api/health");
  return parseJson(response, HealthSchema);
}

export async function getJobs(): Promise<Job[]> {
  const response = await fetch("/api/jobs");
  const schema = z.object({ ok: z.boolean(), jobs: z.array(JobSchema) });
  const data = await parseJson(response, schema);
  return data.jobs;
}

export async function getJob(jobId: string): Promise<Job> {
  const response = await fetch(`/api/jobs/${jobId}`);
  const schema = z.object({ ok: z.boolean(), job: JobSchema });
  const data = await parseJson(response, schema);
  return data.job;
}

export async function getJobLog(jobId: string): Promise<string> {
  const response = await fetch(`/api/jobs/${jobId}/log`);
  const schema = z.object({ ok: z.boolean(), log: z.string() });
  const data = await parseJson(response, schema);
  return data.log;
}

export async function cancelJob(jobId: string): Promise<{ canceled: boolean }> {
  const response = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
  const schema = z.object({ ok: z.boolean(), canceled: z.boolean() });
  return parseJson(response, schema);
}

export async function getSchedules(): Promise<Schedule[]> {
  const response = await fetch("/api/schedules");
  const schema = z.object({ ok: z.boolean(), schedules: z.array(ScheduleSchema) });
  const data = await parseJson(response, schema);
  return data.schedules;
}

export async function pauseSchedule(id: string): Promise<void> {
  const response = await fetch(`/api/schedules/${id}/pause`, { method: "POST" });
  const schema = z.object({ ok: z.boolean() });
  await parseJson(response, schema);
}

export async function resumeSchedule(id: string): Promise<void> {
  const response = await fetch(`/api/schedules/${id}/resume`, { method: "POST" });
  const schema = z.object({ ok: z.boolean() });
  await parseJson(response, schema);
}

export async function getSessionMessages(sessionKey: string): Promise<Message[]> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionKey)}/messages?limit=80`);
  const data = await parseJson(response, MessagesSchema);
  return data.messages;
}

export async function getPlans(params?: {
  sessionKey?: string;
  status?: "active" | "completed" | "blocked" | "failed" | "canceled";
  limit?: number;
}): Promise<Plan[]> {
  const query = new URLSearchParams();
  if (params?.sessionKey?.trim()) {
    query.set("sessionKey", params.sessionKey.trim());
  }
  if (params?.status?.trim()) {
    query.set("status", params.status.trim());
  }
  if (params?.limit && Number.isFinite(params.limit)) {
    query.set("limit", String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`/api/plans${suffix}`);
  const schema = z.object({ ok: z.boolean(), plans: z.array(PlanSchema) });
  const data = await parseJson(response, schema);
  return data.plans;
}

export async function getPlan(planId: string): Promise<Plan> {
  const response = await fetch(`/api/plans/${encodeURIComponent(planId)}`);
  const schema = z.object({ ok: z.boolean(), plan: PlanSchema });
  const data = await parseJson(response, schema);
  return data.plan;
}

export async function generatePlan(params: {
  sessionKey: string;
  objective: string;
  maxSteps?: number;
}): Promise<Plan> {
  const response = await fetch("/api/plans/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionKey: params.sessionKey,
      objective: params.objective,
      maxSteps: params.maxSteps,
    }),
  });
  const schema = z.object({ ok: z.boolean(), plan: PlanSchema });
  const data = await parseJson(response, schema);
  return data.plan;
}

export async function executeNextPlanStep(params: {
  planId: string;
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
  };
}): Promise<{
  ok: boolean;
  reason?: string;
  message?: string;
  stepIndex?: number;
  action?: string;
  execution?: {
    kind: "job" | "exec";
    refId: string;
    status: string;
    startedAt: string;
    command?: string;
  };
  plan?: Plan;
}> {
  const response = await fetch(`/api/plans/${encodeURIComponent(params.planId)}/execute-next`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionKey: params.sessionKey,
      inputs: params.inputs,
    }),
  });
  const schema = z.object({
    ok: z.boolean(),
    reason: z.string().optional(),
    message: z.string().optional(),
    stepIndex: z.number().optional(),
    action: z.string().optional(),
    execution: z
      .object({
        kind: z.enum(["job", "exec"]),
        refId: z.string(),
        status: z.string(),
        startedAt: z.string(),
        command: z.string().optional(),
      })
      .optional(),
    plan: PlanSchema.optional(),
  });
  return parseJson(response, schema);
}

export async function reconcilePlans(params?: {
  planId?: string;
  limit?: number;
}): Promise<{ scannedPlans: number; updatedPlans: number; updatedSteps: number }> {
  const response = await fetch("/api/plans/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      planId: params?.planId,
      limit: params?.limit,
    }),
  });
  const schema = z.object({
    ok: z.boolean(),
    scannedPlans: z.number(),
    updatedPlans: z.number(),
    updatedSteps: z.number(),
  });
  const data = await parseJson(response, schema);
  return {
    scannedPlans: data.scannedPlans,
    updatedPlans: data.updatedPlans,
    updatedSteps: data.updatedSteps,
  };
}

export async function cancelPlan(planId: string, note?: string): Promise<Plan> {
  const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  });
  const schema = z.object({ ok: z.boolean(), plan: PlanSchema });
  const data = await parseJson(response, schema);
  return data.plan;
}

export async function postChat(sessionKey: string, message: string): Promise<{ reply: string }> {
  const response = await fetch("/api/chat?includeMessages=true", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey, message }),
  });
  const schema = z.object({ ok: z.boolean(), reply: z.string() });
  return parseJson(response, schema);
}

export async function getExecApprovals(status = "open"): Promise<ExecApproval[]> {
  const query = new URLSearchParams({ status, limit: "50" });
  const response = await fetch(`/api/exec/approvals?${query.toString()}`);
  const schema = z.object({
    ok: z.boolean(),
    approvals: z.array(
      z.object({
        id: z.string(),
        command: z.string(),
        cwd: z.string(),
        createdAt: z.string(),
        expiresAt: z.string(),
        status: z.enum(["pending", "approved", "denied", "expired"]),
        decidedAt: z.string().optional(),
      }),
    ),
  });
  const data = await parseJson(response, schema);
  return data.approvals;
}

export async function approveExecApproval(id: string): Promise<void> {
  const response = await fetch(`/api/exec/approvals/${encodeURIComponent(id)}/approve`, {
    method: "POST",
  });
  const schema = z.object({ ok: z.boolean() });
  await parseJson(response, schema);
}

export async function denyExecApproval(id: string): Promise<void> {
  const response = await fetch(`/api/exec/approvals/${encodeURIComponent(id)}/deny`, {
    method: "POST",
  });
  const schema = z.object({ ok: z.boolean() });
  await parseJson(response, schema);
}
