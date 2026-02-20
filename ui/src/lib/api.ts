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

export async function postChat(sessionKey: string, message: string): Promise<{ reply: string }> {
  const response = await fetch("/api/chat?includeMessages=true", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey, message }),
  });
  const schema = z.object({ ok: z.boolean(), reply: z.string() });
  return parseJson(response, schema);
}
