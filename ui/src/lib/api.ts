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
    emailIngest: z
      .object({
        polls: z.number(),
        messagesSeen: z.number(),
        processed: z.number(),
        duplicateSkipped: z.number(),
        inFlightSkipped: z.number(),
        lastPollAt: z.string().optional(),
      })
      .nullable(),
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
  action: z.object({
    kind: z.enum(["probe", "capture", "transcode", "hls", "exec"]),
    params: z
      .object({
        inputPath: z.string().optional(),
        outputPath: z.string().optional(),
        outputPlaylistPath: z.string().optional(),
        streamUrl: z.string().optional(),
        durationSeconds: z.number().optional(),
        segmentTime: z.number().optional(),
        args: z.array(z.string()).optional(),
        command: z.string().optional(),
        cwd: z.string().optional(),
        timeoutMs: z.number().optional(),
        background: z.boolean().optional(),
      })
      .optional(),
    requiredInputs: z.array(z.string()).optional(),
  }),
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

export type ExecSession = {
  id: string;
  command: string;
  cwd: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  outputTail: string;
  approvalId?: string;
  failureCode?: string;
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

export async function getExecSessions(params?: {
  status?: string;
  limit?: number;
}): Promise<ExecSession[]> {
  const query = new URLSearchParams();
  if (params?.status?.trim()) {
    query.set("status", params.status.trim());
  }
  query.set("limit", String(params?.limit ?? 100));
  const response = await fetch(`/api/exec/sessions?${query.toString()}`);
  const schema = z.object({
    ok: z.boolean(),
    sessions: z.array(
      z.object({
        id: z.string(),
        command: z.string(),
        cwd: z.string(),
        status: z.string(),
        startedAt: z.string(),
        endedAt: z.string().optional(),
        exitCode: z.number().nullable().optional(),
        timedOut: z.boolean().optional(),
        outputTail: z.string(),
        approvalId: z.string().optional(),
        failureCode: z.string().optional(),
      }),
    ),
  });
  const data = await parseJson(response, schema);
  return data.sessions;
}

export type StreamItem = {
  id: string;
  createdAt: string;
  sourceUrl: string;
  cumulativeDurationSeconds: number;
  segmentCount: number;
  variantCount: number;
  renditionCount?: number;
  bytes: number;
  allVariants: boolean;
  serving: boolean;
  servingUrl: string | null;
  networkServingUrl?: string | null;
  protocol?: string;
  targetDuration?: number;
  selectedUrl?: string;
  finalUrl?: string;
  playbackPath?: string;
  derivedFrom?: string;
  requestedDurationSeconds?: number;
  requestedStartSeconds?: number;
  requestedStartSegment?: number;
  requestedSegmentCount?: number;
  variants?: StreamVariant[];
  renditions?: StreamRendition[];
  faults?: StreamFault[];
};

export type StreamSegment = {
  originalIndex: number;
  sourceUri: string;
  sourceUrl: string;
  localUri: string;
  duration?: number;
  timelineStartSeconds?: number;
  timelineEndSeconds?: number;
  title?: string;
  bytes: number;
  map?: {
    sourceUri: string;
    sourceUrl: string;
    localUri: string;
    bytes: number;
  };
};

export type StreamVariant = {
  localUri: string;
  manifestPath: string;
  targetDuration: number;
  segmentCount: number;
  cumulativeDurationSeconds: number;
  bytes: number;
  variant?: {
    bandwidth?: number;
    averageBandwidth?: number;
    resolution?: string;
    frameRate?: number;
    codecs?: string;
    audioGroupId?: string;
    subtitlesGroupId?: string;
  };
  segments: StreamSegment[];
};

export type StreamRendition = {
  type: string;
  groupId?: string;
  name?: string;
  language?: string;
  codecs?: string;
  channels?: string;
  localUri: string;
  manifestPath: string;
  targetDuration: number;
  segmentCount: number;
  cumulativeDurationSeconds: number;
  bytes: number;
  segments: StreamSegment[];
};

export type StreamFault = {
  type: string;
  targetKind: string;
  targetIndex: number;
  segmentIndex: number;
  description: string;
  createdAt: string;
};

export type StreamAnalysisEntry = {
  kind: "variant" | "rendition";
  mediaIndex: number;
  segmentIndex: number;
  originalSegmentIndex?: number;
  type: "AUDIO" | "SUBTITLES" | "VIDEO";
  label: string;
  localPath: string;
  timelineStartSeconds?: number;
  timelineEndSeconds?: number;
  declaredDurationSeconds?: number;
  actualDurationSeconds?: number;
  durationDeltaSeconds?: number;
  streamCount: number;
  codecName?: string;
  sampleRate?: number;
  channels?: number;
  packetCount?: number;
  firstPtsTime?: number;
  lastPtsTime?: number;
  lastSampleDurationSeconds?: number;
  nextExpectedPtsUs?: number;
  nextActualPtsUs?: number;
  nextDeltaUs?: number;
  continuityStatus?: string;
  boundaryDeltaSeconds?: number;
  boundaryStatus?: string;
  keyframeCount?: number;
  startsWithKeyframe?: boolean;
  maxKeyframeGapSeconds?: number;
  ok: boolean;
  errors: string[];
};

export type StreamAnalysisReport = {
  originId: string;
  ok: boolean;
  sampledSegments: number;
  okSegments: number;
  failedSegments: number;
  issues: Array<{ severity: string; code: string; summary: string; evidence: string[] }>;
  avAlignment: {
    status: "ok" | "warn" | "unknown";
    comparedPairs: number;
    maxDurationDeltaSeconds?: number;
    maxStartPtsDeltaSeconds?: number;
    maxTimelineDriftSeconds?: number;
    notes: string[];
  };
  entries: StreamAnalysisEntry[];
};

const StreamSegmentSchema: z.ZodType<StreamSegment> = z.object({
  originalIndex: z.number(),
  sourceUri: z.string(),
  sourceUrl: z.string(),
  localUri: z.string(),
  duration: z.number().optional(),
  timelineStartSeconds: z.number().optional(),
  timelineEndSeconds: z.number().optional(),
  title: z.string().optional(),
  bytes: z.number(),
  map: z
    .object({
      sourceUri: z.string(),
      sourceUrl: z.string(),
      localUri: z.string(),
      bytes: z.number(),
    })
    .optional(),
});

const StreamVariantSchema: z.ZodType<StreamVariant> = z.object({
  localUri: z.string(),
  manifestPath: z.string(),
  targetDuration: z.number(),
  segmentCount: z.number(),
  cumulativeDurationSeconds: z.number(),
  bytes: z.number(),
  variant: z
    .object({
      bandwidth: z.number().optional(),
      averageBandwidth: z.number().optional(),
      resolution: z.string().optional(),
      frameRate: z.number().optional(),
      codecs: z.string().optional(),
      audioGroupId: z.string().optional(),
      subtitlesGroupId: z.string().optional(),
    })
    .optional(),
  segments: z.array(StreamSegmentSchema),
});

const StreamRenditionSchema: z.ZodType<StreamRendition> = z.object({
  type: z.string(),
  groupId: z.string().optional(),
  name: z.string().optional(),
  language: z.string().optional(),
  codecs: z.string().optional(),
  channels: z.string().optional(),
  localUri: z.string(),
  manifestPath: z.string(),
  targetDuration: z.number(),
  segmentCount: z.number(),
  cumulativeDurationSeconds: z.number(),
  bytes: z.number(),
  segments: z.array(StreamSegmentSchema),
});

const StreamFaultSchema: z.ZodType<StreamFault> = z.object({
  type: z.string(),
  targetKind: z.string(),
  targetIndex: z.number(),
  segmentIndex: z.number(),
  description: z.string(),
  createdAt: z.string(),
});

const StreamSchema: z.ZodType<StreamItem> = z.object({
  id: z.string(),
  createdAt: z.string(),
  sourceUrl: z.string(),
  cumulativeDurationSeconds: z.number(),
  segmentCount: z.number(),
  variantCount: z.number(),
  renditionCount: z.number().optional(),
  bytes: z.number(),
  allVariants: z.boolean(),
  serving: z.boolean(),
  servingUrl: z.string().nullable(),
  networkServingUrl: z.string().nullable().optional(),
  protocol: z.string().optional(),
  targetDuration: z.number().optional(),
  selectedUrl: z.string().optional(),
  finalUrl: z.string().optional(),
  playbackPath: z.string().optional(),
  derivedFrom: z.string().optional(),
  requestedDurationSeconds: z.number().optional(),
  requestedStartSeconds: z.number().optional(),
  requestedStartSegment: z.number().optional(),
  requestedSegmentCount: z.number().optional(),
  variants: z.array(StreamVariantSchema).optional(),
  renditions: z.array(StreamRenditionSchema).optional(),
  faults: z.array(StreamFaultSchema).optional(),
});

export async function getStreams(): Promise<StreamItem[]> {
  const response = await fetch("/api/streams");
  const schema = z.object({
    ok: z.boolean(),
    streams: z.array(StreamSchema),
  });
  const data = await parseJson(response, schema);
  return data.streams;
}

export async function getStream(originId: string): Promise<StreamItem> {
  const response = await fetch(`/api/streams/${encodeURIComponent(originId)}`);
  const schema = z.object({
    ok: z.boolean(),
    stream: StreamSchema,
  });
  const data = await parseJson(response, schema);
  return data.stream;
}

export async function analyzeStream(originId: string, params?: {
  timeoutMs?: number;
  maxMediaPlaylists?: number;
  maxSegmentsPerPlaylist?: number;
  startSegment?: number;
  segmentCount?: number;
  full?: boolean;
}): Promise<StreamAnalysisReport> {
  const response = await fetch(`/api/streams/${encodeURIComponent(originId)}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });
  const entrySchema: z.ZodType<StreamAnalysisEntry> = z.object({
    kind: z.enum(["variant", "rendition"]),
    mediaIndex: z.number(),
    segmentIndex: z.number(),
    originalSegmentIndex: z.number().optional(),
    type: z.enum(["AUDIO", "SUBTITLES", "VIDEO"]),
    label: z.string(),
    localPath: z.string(),
    timelineStartSeconds: z.number().optional(),
    timelineEndSeconds: z.number().optional(),
    declaredDurationSeconds: z.number().optional(),
    actualDurationSeconds: z.number().optional(),
    durationDeltaSeconds: z.number().optional(),
    streamCount: z.number(),
    codecName: z.string().optional(),
    sampleRate: z.number().optional(),
    channels: z.number().optional(),
    packetCount: z.number().optional(),
    firstPtsTime: z.number().optional(),
    lastPtsTime: z.number().optional(),
    lastSampleDurationSeconds: z.number().optional(),
    nextExpectedPtsUs: z.number().optional(),
    nextActualPtsUs: z.number().optional(),
    nextDeltaUs: z.number().optional(),
    continuityStatus: z.string().optional(),
    boundaryDeltaSeconds: z.number().optional(),
    boundaryStatus: z.string().optional(),
    keyframeCount: z.number().optional(),
    startsWithKeyframe: z.boolean().optional(),
    maxKeyframeGapSeconds: z.number().optional(),
    ok: z.boolean(),
    errors: z.array(z.string()),
  });
  const schema = z.object({
    ok: z.boolean(),
    report: z.object({
      originId: z.string(),
      ok: z.boolean(),
      sampledSegments: z.number(),
      okSegments: z.number(),
      failedSegments: z.number(),
      issues: z.array(z.object({
        severity: z.string(),
        code: z.string(),
        summary: z.string(),
        evidence: z.array(z.string()),
      })),
      avAlignment: z.object({
        status: z.enum(["ok", "warn", "unknown"]),
        comparedPairs: z.number(),
        maxDurationDeltaSeconds: z.number().optional(),
        maxStartPtsDeltaSeconds: z.number().optional(),
        maxTimelineDriftSeconds: z.number().optional(),
        notes: z.array(z.string()),
      }),
      entries: z.array(entrySchema),
    }),
  });
  const data = await parseJson(response, schema);
  return data.report;
}

export async function cloneStream(params: {
  url: string;
  originId?: string;
  durationSeconds?: number;
  allVariants?: boolean;
}): Promise<{ stream: { id: string } }> {
  const response = await fetch("/api/streams/clone", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const schema = z.object({ ok: z.boolean(), stream: z.object({ id: z.string() }) });
  return parseJson(response, schema);
}

export async function serveStream(originId: string, params?: {
  host?: "127.0.0.1" | "localhost" | "0.0.0.0";
}): Promise<{ serve: { playbackUrl: string; networkPlaybackUrl?: string | null } }> {
  const response = await fetch(`/api/streams/${encodeURIComponent(originId)}/serve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });
  const schema = z.object({
    ok: z.boolean(),
    serve: z.object({
      playbackUrl: z.string(),
      networkPlaybackUrl: z.string().nullable().optional(),
    }),
  });
  return parseJson(response, schema);
}

export async function stopStream(originId: string): Promise<void> {
  const response = await fetch(`/api/streams/${encodeURIComponent(originId)}/stop`, { method: "POST" });
  const schema = z.object({ ok: z.boolean() });
  await parseJson(response, schema);
}

export async function deleteStream(originId: string): Promise<void> {
  const response = await fetch(`/api/streams/${encodeURIComponent(originId)}`, { method: "DELETE" });
  const schema = z.object({ ok: z.boolean() });
  await parseJson(response, schema);
}

export async function getExecSessionLog(params: {
  sessionId: string;
  offset?: number;
  limit?: number;
}): Promise<{ session: ExecSession; output: string; page: string }> {
  const query = new URLSearchParams({
    offset: String(params.offset ?? 0),
    limit: String(params.limit ?? 12000),
  });
  const response = await fetch(`/api/exec/sessions/${encodeURIComponent(params.sessionId)}/log?${query.toString()}`);
  const schema = z.object({
    ok: z.boolean(),
    session: z.object({
      id: z.string(),
      command: z.string(),
      cwd: z.string(),
      status: z.string(),
      startedAt: z.string(),
      endedAt: z.string().optional(),
      exitCode: z.number().nullable().optional(),
      timedOut: z.boolean().optional(),
      outputTail: z.string(),
      approvalId: z.string().optional(),
      failureCode: z.string().optional(),
    }),
    output: z.string(),
    page: z.string(),
  });
  return parseJson(response, schema);
}
