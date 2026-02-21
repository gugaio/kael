import crypto from "node:crypto";
import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
export type PlanStatus = "active" | "completed" | "blocked" | "failed" | "canceled";

export type PlanStepCheckpoint = {
  at: string;
  status: PlanStepStatus;
  notes?: string;
};

export type PlanStep = {
  id: string;
  title: string;
  status: PlanStepStatus;
  notes?: string;
  updatedAt: string;
  checkpoints: PlanStepCheckpoint[];
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

export type PlanExecuteNextResult =
  | {
      ok: true;
      plan: ExecutionPlan;
      stepIndex: number;
      action: "probe" | "capture" | "transcode" | "hls" | "exec" | "manual";
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
      action?: "probe" | "capture" | "transcode" | "hls" | "exec" | "manual";
    };

export type PlanReconcileResult = {
  scannedPlans: number;
  updatedPlans: number;
  updatedSteps: number;
};

export class PlannerService {
  private readonly plansPath: string;
  private plans = new Map<string, ExecutionPlan>();

  constructor(dataDir: string) {
    this.plansPath = path.join(dataDir, "plans", "plans.json");
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
      .map((title) => ({
        id: crypto.randomUUID(),
        title,
        status: "pending" as const,
        updatedAt: now,
        checkpoints: [{ at: now, status: "pending" as const }],
      }));
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
    const steps = deriveStepsFromObjective(objective, params.maxSteps);
    return this.create({
      sessionKey: params.sessionKey,
      title: title.length > 120 ? `${title.slice(0, 120)}...` : title,
      steps,
    });
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
    const steps = [
      ...current.steps,
      {
        id: crypto.randomUUID(),
        title,
        status: "pending" as const,
        updatedAt: now,
        checkpoints: [{ at: now, status: "pending" as const }],
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
    const action = inferExecutionAction(next.step.title);
    const sessionKey = params.sessionKey?.trim() || plan.sessionKey;
    const rawInputs = params.inputs ?? {};
    const inputs: PlanExecutionInputs =
      action === "exec" && !rawInputs.command
        ? { ...rawInputs, command: extractShellCommandFromStepTitle(next.step.title) ?? undefined }
        : rawInputs;

    if (action === "manual") {
      const updated = await this.updateStep({
        planId: plan.id,
        stepIndex: next.stepIndex,
        status: "completed",
        notes: "Executor: etapa manual concluida automaticamente.",
      });
      return {
        ok: true,
        plan: updated ?? plan,
        stepIndex: next.stepIndex,
        action,
        reason: "manual_step_completed",
      };
    }

    const missing = requiredInputForAction(action, inputs);
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

function inferExecutionAction(stepTitleRaw: string): "probe" | "capture" | "transcode" | "hls" | "exec" | "manual" {
  const stepTitle = stepTitleRaw.toLowerCase();
  const has = (...tokens: string[]) => tokens.some((token) => stepTitle.includes(token));
  if (has("probe", "inspec", "metadata", "metadado")) {
    return "probe";
  }
  if (has("captura", "capture", "stream", "ingest")) {
    return "capture";
  }
  if (has("transcode", "transcod", "encode", "converter")) {
    return "transcode";
  }
  if (has("hls", "playlist", "segment")) {
    return "hls";
  }
  if (has("comando", "shell", "bash", "terminal")) {
    return "exec";
  }
  return "manual";
}

function requiredInputForAction(
  action: "probe" | "capture" | "transcode" | "hls" | "exec" | "manual",
  inputs: PlanExecutionInputs,
): string | null {
  if (action === "manual") {
    return null;
  }
  if (action === "probe") {
    return inputs.inputPath ? null : "inputPath";
  }
  if (action === "capture") {
    if (!inputs.streamUrl) {
      return "streamUrl";
    }
    return inputs.outputPath ? null : "outputPath";
  }
  if (action === "transcode") {
    if (!inputs.inputPath) {
      return "inputPath";
    }
    return inputs.outputPath ? null : "outputPath";
  }
  if (action === "hls") {
    if (!inputs.inputPath) {
      return "inputPath";
    }
    return inputs.outputPlaylistPath ? null : "outputPlaylistPath";
  }
  return inputs.command ? null : "command";
}

function runtimeNotAvailable(
  action: "probe" | "capture" | "transcode" | "hls" | "exec" | "manual",
  plan: ExecutionPlan,
  stepIndex: number,
): PlanExecuteNextResult {
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
    return {
      ...step,
      checkpoints,
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
  if (
    exec.status === "failed" ||
    exec.status === "timed_out" ||
    exec.status === "denied"
  ) {
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

function deriveStepsFromObjective(objectiveRaw: string, maxStepsRaw?: number): string[] {
  const objective = objectiveRaw.toLowerCase();
  const maxSteps = Number.isFinite(maxStepsRaw) ? Math.max(3, Math.min(12, Math.floor(maxStepsRaw ?? 8))) : 8;
  const steps: string[] = [];

  const add = (step: string) => {
    if (!steps.includes(step)) {
      steps.push(step);
    }
  };

  add("Confirmar objetivo e entradas/saidas esperadas");

  const has = (...tokens: string[]) => tokens.some((token) => objective.includes(token));
  const isVideoContext = has("video", "transcode", "hls", "stream", "ffmpeg", "vlc", "codec", "captura");
  const shellCommands = extractShellCommandsFromObjective(objective);
  const isShellContext =
    shellCommands.length > 0 || has("bash", "shell", "terminal", "diretorio", "diretório");

  if (isShellContext) {
    const shellSteps = [
      "Confirmar objetivo, escopo e seguranca dos comandos",
      ...shellCommands.map((command) => `Executar comando shell: ${command}`),
      "Validar saida dos comandos e consolidar resposta final",
    ];
    return shellSteps.slice(0, maxSteps);
  }

  if (isVideoContext) {
    add("Validar caminhos e requisitos de ambiente");
  }
  if (has("probe", "inspec", "codec", "metadata", "metadado")) {
    add("Executar probe da midia para confirmar codec, duracao e trilhas");
  }
  if (has("captura", "capture", "stream", "rtmp", "ingest")) {
    add("Executar captura inicial e validar arquivo gerado");
  }
  if (has("transcode", "transcod", "encode", "converter", "conversao", "convert")) {
    add("Executar transcode com preset seguro e monitorar logs");
  }
  if (has("hls", "playlist", "segment")) {
    add("Gerar HLS (playlist + segmentos) e validar reproducao");
  }
  if (has("schedule", "agendar", "agend", "cron", "periodic", "periodico")) {
    add("Configurar schedule e politica de retries");
  }

  add("Validar resultado final e registrar aprendizados na memoria");

  if (steps.length <= 2) {
    return [
      "Confirmar objetivo, restricoes e criterio de sucesso",
      "Executar em pequenos passos com validacao por etapa",
      "Consolidar resultado final e proximos passos",
    ].slice(0, maxSteps);
  }

  return steps.slice(0, maxSteps);
}

function extractShellCommandsFromObjective(objective: string): string[] {
  const normalized = objective.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }
  const parts = normalized
    .split(/\b(?:depois|em seguida|then|e depois|;|,)\b/gi)
    .map((item) => item.trim())
    .filter(Boolean);
  const commands: string[] = [];
  for (const part of parts) {
    const command = extractSingleShellCommand(part);
    if (command && !commands.includes(command)) {
      commands.push(command);
    }
  }
  return commands.slice(0, 6);
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
