import crypto from "node:crypto";
import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
export type PlanStatus = "active" | "completed" | "blocked" | "failed" | "canceled";
export type PlanActionKind = "probe" | "capture" | "transcode" | "hls" | "exec";

export type PlanStepCheckpoint = {
  at: string;
  status: PlanStepStatus;
  notes?: string;
};

export type PlanExecutionInputs = {
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

export type PlanStepAction = {
  kind: PlanActionKind;
  params: PlanExecutionInputs;
  requiredInputs: string[];
};

export type PlanStep = {
  id: string;
  title: string;
  status: PlanStepStatus;
  notes?: string;
  updatedAt: string;
  checkpoints: PlanStepCheckpoint[];
  action: PlanStepAction;
  execution?: {
    kind: "job" | "exec";
    refId: string;
    status: string;
    startedAt: string;
    command?: string;
  };
};

export type ExecutionPlan = {
  id: string;
  sessionKey: string;
  title: string;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
  steps: PlanStep[];
};

type PlannerStore = {
  plans: Record<string, ExecutionPlan>;
};

type PlanStepDraft = {
  title: string;
  action: PlanStepAction;
};
export type PlanStepDraftInput = {
  title: string;
  action: {
    kind: PlanActionKind;
    params?: PlanExecutionInputs;
  };
};

export type PlanExecuteNextResult =
  | {
      ok: true;
      plan: ExecutionPlan;
      stepIndex: number;
      action: PlanActionKind;
      execution?: PlanStep["execution"];
      reason?: string;
    }
  | {
      ok: false;
      reason:
        | "plan_not_found"
        | "no_next_step"
        | "missing_input"
        | "runtime_not_available"
        | "execution_failed";
      message: string;
      plan?: ExecutionPlan;
      stepIndex?: number;
      action?: PlanActionKind;
    };

export type PlanReconcileResult = {
  scannedPlans: number;
  updatedPlans: number;
  updatedSteps: number;
};

export class PlannerService {
  private readonly plansPath: string;
  private plans = new Map<string, ExecutionPlan>();
  private readonly generateDrafts?: (params: {
    sessionKey: string;
    objective: string;
    maxSteps?: number;
  }) => Promise<PlanStepDraftInput[]>;

  constructor(
    dataDir: string,
    options?: {
      generateDrafts?: (params: {
        sessionKey: string;
        objective: string;
        maxSteps?: number;
      }) => Promise<PlanStepDraftInput[]>;
    },
  ) {
    this.plansPath = path.join(dataDir, "plans", "plans.json");
    this.generateDrafts = options?.generateDrafts;
  }

  async init(): Promise<void> {
    await ensureDir(path.dirname(this.plansPath));
    const loaded = await readJsonFile<PlannerStore>(this.plansPath, { plans: {} });
    const normalized = Object.fromEntries(
      Object.entries(loaded.plans).map(([id, plan]) => [id, normalizePlan(plan)]),
    );
    this.plans = new Map(Object.entries(normalized));
    await this.persist();
  }

  list(params?: { sessionKey?: string; status?: PlanStatus; limit?: number }): ExecutionPlan[] {
    const sessionKey = params?.sessionKey?.trim();
    const status = params?.status;
    const limit = Math.max(1, Math.floor(params?.limit ?? 50));
    return Array.from(this.plans.values())
      .filter((plan) => (sessionKey ? plan.sessionKey === sessionKey : true))
      .filter((plan) => (status ? plan.status === status : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  get(planId: string): ExecutionPlan | null {
    return this.plans.get(planId) ?? null;
  }

  async create(params: { sessionKey: string; title: string; steps: string[] }): Promise<ExecutionPlan> {
    const now = new Date().toISOString();
    const normalizedSteps = params.steps
      .map((title) => title.trim())
      .filter(Boolean)
      .map((title) => {
        const draft = deriveStepFromTitle(title);
        return {
          id: crypto.randomUUID(),
          title,
          status: "pending" as const,
          updatedAt: now,
          checkpoints: [{ at: now, status: "pending" as const }],
          action: draft.action,
        };
      });
    const plan: ExecutionPlan = {
      id: crypto.randomUUID(),
      sessionKey: params.sessionKey,
      title: params.title.trim() || "Plano de execucao",
      status: normalizedSteps.length === 0 ? "completed" : "active",
      createdAt: now,
      updatedAt: now,
      steps: normalizedSteps,
    };
    this.plans.set(plan.id, plan);
    await this.persist();
    return plan;
  }

  async generate(params: {
    sessionKey: string;
    objective: string;
    maxSteps?: number;
  }): Promise<ExecutionPlan> {
    const objective = params.objective.trim();
    const title = objective ? `Plano: ${objective}` : "Plano de execucao";
    const draftsRaw = this.generateDrafts
      ? await this.generateDrafts({
          sessionKey: params.sessionKey,
          objective,
          maxSteps: params.maxSteps,
        })
      : null;
    const drafts =
      Array.isArray(draftsRaw) && draftsRaw.length > 0
        ? normalizeDrafts(draftsRaw, params.maxSteps)
        : [
            {
              title: "Definir comando shell principal para cumprir o objetivo",
              action: createAction("exec"),
            },
          ];
    const now = new Date().toISOString();
    const steps: PlanStep[] = drafts.map((draft) => ({
      id: crypto.randomUUID(),
      title: draft.title,
      status: "pending",
      updatedAt: now,
      checkpoints: [{ at: now, status: "pending" }],
      action: draft.action,
    }));
    const plan: ExecutionPlan = {
      id: crypto.randomUUID(),
      sessionKey: params.sessionKey,
      title: title.length > 120 ? `${title.slice(0, 120)}...` : title,
      status: steps.length === 0 ? "completed" : "active",
      createdAt: now,
      updatedAt: now,
      steps,
    };
    this.plans.set(plan.id, plan);
    await this.persist();
    return plan;
  }

  async updateStep(params: {
    planId: string;
    stepIndex: number;
    status: PlanStepStatus;
    notes?: string;
    execution?: PlanStep["execution"];
  }): Promise<ExecutionPlan | null> {
    const current = this.plans.get(params.planId);
    if (!current) {
      return null;
    }
    if (params.stepIndex < 0 || params.stepIndex >= current.steps.length) {
      return null;
    }

    const now = new Date().toISOString();
    const steps = [...current.steps];
    const step = steps[params.stepIndex];
    const note = params.notes?.trim();
    const checkpoints = [
      ...(Array.isArray(step.checkpoints) ? step.checkpoints : []),
      {
        at: now,
        status: params.status,
        ...(note ? { notes: note } : {}),
      },
    ];
    steps[params.stepIndex] = {
      ...step,
      status: params.status,
      notes: mergeStepNotes(step.notes, note, now),
      updatedAt: now,
      checkpoints,
      execution: params.execution ?? step.execution,
    };

    const next: ExecutionPlan = {
      ...current,
      steps,
      status: derivePlanStatus(steps),
      updatedAt: now,
    };
    this.plans.set(next.id, next);
    await this.persist();
    return next;
  }

  async appendStep(params: { planId: string; title: string }): Promise<ExecutionPlan | null> {
    const current = this.plans.get(params.planId);
    if (!current) {
      return null;
    }
    const title = params.title.trim();
    if (!title) {
      return current;
    }
    const now = new Date().toISOString();
    const draft = deriveStepFromTitle(title);
    const steps = [
      ...current.steps,
      {
        id: crypto.randomUUID(),
        title,
        status: "pending" as const,
        updatedAt: now,
        checkpoints: [{ at: now, status: "pending" as const }],
        action: draft.action,
      },
    ];
    const next: ExecutionPlan = {
      ...current,
      steps,
      status: derivePlanStatus(steps),
      updatedAt: now,
    };
    this.plans.set(next.id, next);
    await this.persist();
    return next;
  }

  async cancelPlan(params: { planId: string; note?: string }): Promise<ExecutionPlan | null> {
    const current = this.plans.get(params.planId);
    if (!current) {
      return null;
    }
    const now = new Date().toISOString();
    const note = params.note?.trim() || "Plano cancelado pelo operador.";
    const steps = current.steps.map((step) => {
      const checkpoints = [
        ...(Array.isArray(step.checkpoints) ? step.checkpoints : []),
        {
          at: now,
          status: "canceled" as const,
          notes: note,
        },
      ];
      return {
        ...step,
        status: "canceled" as const,
        notes: mergeStepNotes(step.notes, note, now),
        updatedAt: now,
        checkpoints,
        execution: step.execution
          ? {
              ...step.execution,
              status: "canceled",
            }
          : undefined,
      };
    });

    const next: ExecutionPlan = {
      ...current,
      steps,
      status: "canceled",
      updatedAt: now,
    };
    this.plans.set(next.id, next);
    await this.persist();
    return next;
  }

  nextAction(planId: string): { stepIndex: number; step: PlanStep } | null {
    const plan = this.plans.get(planId);
    if (!plan) {
      return null;
    }
    const index = plan.steps.findIndex((step) => step.status === "pending" || step.status === "in_progress");
    if (index < 0) {
      return null;
    }
    return { stepIndex: index, step: plan.steps[index] };
  }

  async executeNext(params: {
    planId: string;
    sessionKey?: string;
    inputs?: PlanExecutionInputs;
    runtime: {
      startProbeMedia?: (args: { sessionKey: string; inputPath: string }) => Promise<{ id: string; status: string }>;
      startCaptureStream?: (args: {
        sessionKey: string;
        streamUrl: string;
        outputPath: string;
        durationSeconds?: number;
      }) => Promise<{ id: string; status: string }>;
      startTranscode?: (args: {
        sessionKey: string;
        inputPath: string;
        outputPath: string;
        args?: string[];
      }) => Promise<{ id: string; status: string }>;
      startConvertHls?: (args: {
        sessionKey: string;
        inputPath: string;
        outputPlaylistPath: string;
        segmentTime?: number;
      }) => Promise<{ id: string; status: string }>;
      execCommand?: (args: {
        sessionKey: string;
        command: string;
        cwd?: string;
        timeoutMs?: number;
        background?: boolean;
      }) => Promise<{ id: string; status: string; command: string; cwd: string }>;
    };
  }): Promise<PlanExecuteNextResult> {
    const plan = this.get(params.planId);
    if (!plan) {
      return {
        ok: false,
        reason: "plan_not_found",
        message: `plan ${params.planId} not found`,
      };
    }
    const next = this.nextAction(params.planId);
    if (!next) {
      return {
        ok: false,
        reason: "no_next_step",
        message: "plan has no pending/in_progress step",
        plan,
      };
    }

    const action = next.step.action.kind;
    const sessionKey = params.sessionKey?.trim() || plan.sessionKey;
    const inputs: PlanExecutionInputs = {
      ...(next.step.action.params ?? {}),
      ...(params.inputs ?? {}),
    };

    const missing = missingRequiredInputs(next.step.action.requiredInputs, inputs);
    if (missing) {
      const updated = await this.updateStep({
        planId: plan.id,
        stepIndex: next.stepIndex,
        status: "blocked",
        notes: `Executor: faltando input obrigatorio (${missing}) para acao ${action}.`,
      });
      return {
        ok: false,
        reason: "missing_input",
        message: `missing input: ${missing}`,
        plan: updated ?? plan,
        stepIndex: next.stepIndex,
        action,
      };
    }

    try {
      let execution: PlanStep["execution"] | undefined;
      if (action === "probe") {
        if (!params.runtime.startProbeMedia) {
          return runtimeNotAvailable(action, plan, next.stepIndex);
        }
        const job = await params.runtime.startProbeMedia({
          sessionKey,
          inputPath: inputs.inputPath ?? "",
        });
        execution = {
          kind: "job",
          refId: job.id,
          status: job.status,
          startedAt: new Date().toISOString(),
        };
      } else if (action === "capture") {
        if (!params.runtime.startCaptureStream) {
          return runtimeNotAvailable(action, plan, next.stepIndex);
        }
        const job = await params.runtime.startCaptureStream({
          sessionKey,
          streamUrl: inputs.streamUrl ?? "",
          outputPath: inputs.outputPath ?? "",
          durationSeconds: inputs.durationSeconds,
        });
        execution = {
          kind: "job",
          refId: job.id,
          status: job.status,
          startedAt: new Date().toISOString(),
        };
      } else if (action === "transcode") {
        if (!params.runtime.startTranscode) {
          return runtimeNotAvailable(action, plan, next.stepIndex);
        }
        const job = await params.runtime.startTranscode({
          sessionKey,
          inputPath: inputs.inputPath ?? "",
          outputPath: inputs.outputPath ?? "",
          args: inputs.args,
        });
        execution = {
          kind: "job",
          refId: job.id,
          status: job.status,
          startedAt: new Date().toISOString(),
        };
      } else if (action === "hls") {
        if (!params.runtime.startConvertHls) {
          return runtimeNotAvailable(action, plan, next.stepIndex);
        }
        const job = await params.runtime.startConvertHls({
          sessionKey,
          inputPath: inputs.inputPath ?? "",
          outputPlaylistPath: inputs.outputPlaylistPath ?? "",
          segmentTime: inputs.segmentTime,
        });
        execution = {
          kind: "job",
          refId: job.id,
          status: job.status,
          startedAt: new Date().toISOString(),
        };
      } else {
        if (!params.runtime.execCommand) {
          return runtimeNotAvailable(action, plan, next.stepIndex);
        }
        const exec = await params.runtime.execCommand({
          sessionKey,
          command: inputs.command ?? "",
          cwd: inputs.cwd,
          timeoutMs: inputs.timeoutMs,
          background: inputs.background,
        });
        execution = {
          kind: "exec",
          refId: exec.id,
          status: exec.status,
          command: exec.command,
          startedAt: new Date().toISOString(),
        };
      }

      const updated = await this.updateStep({
        planId: plan.id,
        stepIndex: next.stepIndex,
        status: "in_progress",
        notes: `Executor: acao ${action} disparada.`,
        execution,
      });
      return {
        ok: true,
        plan: updated ?? plan,
        stepIndex: next.stepIndex,
        action,
        execution,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = await this.updateStep({
        planId: plan.id,
        stepIndex: next.stepIndex,
        status: "failed",
        notes: `Executor: falha ao disparar ${action}: ${message}`,
      });
      return {
        ok: false,
        reason: "execution_failed",
        message,
        plan: updated ?? plan,
        stepIndex: next.stepIndex,
        action,
      };
    }
  }

  async reconcile(params: {
    planId?: string;
    limit?: number;
    runtime: {
      getJob?: (jobId: string) => Promise<{ status: string; error?: string } | null>;
      pollExec?: (sessionId: string) => Promise<{ status: string; message?: string } | null>;
    };
  }): Promise<PlanReconcileResult> {
    const plans = params.planId
      ? [this.get(params.planId)].filter((value): value is ExecutionPlan => value !== null)
      : this.list({ status: "active", limit: params.limit ?? 100 });

    let updatedSteps = 0;
    const touchedPlanIds = new Set<string>();

    for (const plan of plans) {
      for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex += 1) {
        const step = plan.steps[stepIndex];
        if (step.status !== "in_progress" || !step.execution) {
          continue;
        }

        const resolution = await resolveExecutionStatus(step.execution, params.runtime);
        if (!resolution) {
          continue;
        }

        await this.updateStep({
          planId: plan.id,
          stepIndex,
          status: resolution.status,
          notes: `Reconciler: execucao ${step.execution.kind}:${step.execution.refId} finalizou com ${resolution.observedStatus}.`,
          execution: {
            ...step.execution,
            status: resolution.observedStatus,
          },
        });
        updatedSteps += 1;
        touchedPlanIds.add(plan.id);
      }
    }

    return {
      scannedPlans: plans.length,
      updatedPlans: touchedPlanIds.size,
      updatedSteps,
    };
  }

  private async persist(): Promise<void> {
    await writeJsonFile(this.plansPath, {
      plans: Object.fromEntries(this.plans.entries()),
    } satisfies PlannerStore);
  }
}

function derivePlanStatus(steps: PlanStep[]): PlanStatus {
  if (steps.length === 0) {
    return "completed";
  }
  if (steps.every((step) => step.status === "canceled")) {
    return "canceled";
  }
  if (steps.some((step) => step.status === "failed")) {
    return "failed";
  }
  if (steps.some((step) => step.status === "blocked")) {
    return "blocked";
  }
  if (steps.every((step) => step.status === "completed" || step.status === "canceled")) {
    return "completed";
  }
  return "active";
}

function normalizeDrafts(drafts: PlanStepDraftInput[], maxStepsRaw?: number): PlanStepDraft[] {
  const maxSteps = Number.isFinite(maxStepsRaw) ? Math.max(1, Math.min(20, Math.floor(maxStepsRaw ?? 8))) : 8;
  const normalized: PlanStepDraft[] = [];
  for (const raw of drafts) {
    const title = raw?.title?.trim();
    const kind = raw?.action?.kind;
    if (!title || !kind) {
      continue;
    }
    normalized.push({
      title,
      action: createAction(kind, raw.action.params ?? {}),
    });
    if (normalized.length >= maxSteps) {
      break;
    }
  }
  return normalized;
}

function requiredInputsForAction(kind: PlanActionKind): string[] {
  if (kind === "probe") {
    return ["inputPath"];
  }
  if (kind === "capture") {
    return ["streamUrl", "outputPath"];
  }
  if (kind === "transcode") {
    return ["inputPath", "outputPath"];
  }
  if (kind === "hls") {
    return ["inputPath", "outputPlaylistPath"];
  }
  return ["command"];
}

function createAction(kind: PlanActionKind, params: PlanExecutionInputs = {}): PlanStepAction {
  const requiredInputs = requiredInputsForAction(kind).filter((input) => !hasInput(params, input));
  return {
    kind,
    params,
    requiredInputs,
  };
}

function missingRequiredInputs(requiredInputs: string[], inputs: PlanExecutionInputs): string | null {
  for (const input of requiredInputs) {
    if (!hasInput(inputs, input)) {
      return input;
    }
  }
  return null;
}

function hasInput(inputs: PlanExecutionInputs, key: string): boolean {
  const value = (inputs as Record<string, unknown>)[key];
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== undefined && value !== null;
}

function runtimeNotAvailable(action: PlanActionKind, plan: ExecutionPlan, stepIndex: number): PlanExecuteNextResult {
  return {
    ok: false,
    reason: "runtime_not_available",
    message: `runtime callback for action ${action} is not available`,
    plan,
    stepIndex,
    action,
  };
}

function normalizePlan(plan: ExecutionPlan): ExecutionPlan {
  const steps = plan.steps.map((step) => {
    const checkpoints =
      Array.isArray(step.checkpoints) && step.checkpoints.length > 0
        ? step.checkpoints
        : [{ at: step.updatedAt || plan.updatedAt || plan.createdAt, status: step.status }];
    const action = step.action ?? deriveStepFromTitle(step.title).action;
    return {
      ...step,
      checkpoints,
      action,
    };
  });
  return {
    ...plan,
    steps,
    status: derivePlanStatus(steps),
  };
}

async function resolveExecutionStatus(
  execution: NonNullable<PlanStep["execution"]>,
  runtime: {
    getJob?: (jobId: string) => Promise<{ status: string; error?: string } | null>;
    pollExec?: (sessionId: string) => Promise<{ status: string; message?: string } | null>;
  },
): Promise<{ status: PlanStepStatus; observedStatus: string } | null> {
  if (execution.kind === "job") {
    if (!runtime.getJob) {
      return null;
    }
    const job = await runtime.getJob(execution.refId);
    if (!job) {
      return null;
    }
    if (job.status === "succeeded") {
      return { status: "completed", observedStatus: job.status };
    }
    if (job.status === "failed") {
      return { status: "failed", observedStatus: job.status };
    }
    if (job.status === "canceled") {
      return { status: "canceled", observedStatus: job.status };
    }
    return null;
  }

  if (!runtime.pollExec) {
    return null;
  }
  const exec = await runtime.pollExec(execution.refId);
  if (!exec) {
    return null;
  }
  if (exec.status === "completed") {
    return { status: "completed", observedStatus: exec.status };
  }
  if (exec.status === "failed" || exec.status === "timed_out" || exec.status === "denied") {
    return { status: "failed", observedStatus: exec.status };
  }
  if (exec.status === "canceled") {
    return { status: "canceled", observedStatus: exec.status };
  }
  return null;
}

function mergeStepNotes(existing: string | undefined, next: string | undefined, nowIso: string): string | undefined {
  if (!next) {
    return existing;
  }
  const tagged = `[${nowIso}] ${next}`;
  if (!existing) {
    return tagged;
  }
  return `${existing}\n${tagged}`;
}

function deriveStepFromTitle(titleRaw: string): PlanStepDraft {
  const title = titleRaw.trim();
  const lower = title.toLowerCase();

  const shellCommand = extractShellCommandFromStepTitle(title) ?? extractSingleShellCommand(title);
  if (shellCommand) {
    return {
      title,
      action: createAction("exec", { command: shellCommand }),
    };
  }

  if (lower.includes("probe") || lower.includes("metadado") || lower.includes("metadata") || lower.includes("codec")) {
    return { title, action: createAction("probe") };
  }
  if (lower.includes("captura") || lower.includes("capture") || lower.includes("stream")) {
    return { title, action: createAction("capture") };
  }
  if (lower.includes("transcode") || lower.includes("transcod") || lower.includes("encode") || lower.includes("converter")) {
    return { title, action: createAction("transcode") };
  }
  if (lower.includes("hls") || lower.includes("playlist") || lower.includes("segment")) {
    return { title, action: createAction("hls") };
  }

  return { title, action: createAction("exec") };
}

function extractSingleShellCommand(text: string): string | null {
  const quoted = text.match(/(?:comando\s+)?["'`](.+?)["'`]/i);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }
  const patterns = [
    /\b(ls(?:\s+[^\n,;]+)?)\b/i,
    /\b(cat(?:\s+[^\n,;]+)?)\b/i,
    /\b(pwd)\b/i,
    /\b(find(?:\s+[^\n,;]+)?)\b/i,
    /\b(grep(?:\s+[^\n,;]+)?)\b/i,
    /\b(curl(?:\s+[^\n,;]+)?)\b/i,
    /\b(date)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function extractShellCommandFromStepTitle(stepTitle: string): string | null {
  const match = stepTitle.match(/executar comando shell:\s*(.+)$/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}
