import crypto from "node:crypto";
import path from "node:path";
import { ActionRegistry, type ActionHandler } from "./action-registry.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
export type PlanStatus = "active" | "completed" | "blocked" | "failed" | "canceled";
export type PlanActionKind =
  | "probe"
  | "capture"
  | "transcode"
  | "hls"
  | "exec"
  | "wait_execution"
  | "cancel_execution";

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
  targetStepIndex?: number;
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
  private readonly actionRegistry = new ActionRegistry();

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

  registerActionHandler(kind: string, handler: ActionHandler): void {
    this.actionRegistry.register(kind, handler);
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
    const controlStep = findPendingControlStepForInProgressExecution(plan);
    if (controlStep) {
      return controlStep;
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
      execCommand?: (args: {
        sessionKey: string;
        command: string;
        cwd?: string;
        timeoutMs?: number;
        background?: boolean;
      }) => Promise<{
        id: string;
        status: string;
        command: string;
        cwd: string;
        outputTail?: string;
        exitCode?: number | null;
      }>;
      getJob?: (jobId: string) => Promise<{ status: string; error?: string } | null>;
      pollExec?: (sessionId: string) => Promise<{ status: string; message?: string } | null>;
      cancelJob?: (jobId: string) => Promise<{ canceled: boolean; status?: string; message?: string }>;
      cancelExec?: (sessionId: string) => Promise<{ canceled: boolean; status?: string; message?: string }>;
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

    const isBuiltIn = action === "exec" || action === "wait_execution" || action === "cancel_execution";
    const requiredInputs = isBuiltIn
      ? requiredInputsForAction(action)
      : this.actionRegistry.get(action)?.requiredInputs ?? [];

    const missing = missingRequiredInputs(requiredInputs, inputs);
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
      if (action === "exec") {
        return await this.executeExecBuiltIn({
          plan,
          stepIndex: next.stepIndex,
          sessionKey,
          inputs,
          runtime: params.runtime,
        });
      }

      if (action === "wait_execution" || action === "cancel_execution") {
        return await this.executeControlAction({
          plan,
          stepIndex: next.stepIndex,
          action,
          sessionKey,
          inputs,
          runtime: params.runtime,
        });
      }

      return await this.executeRegisteredAction({
        plan,
        stepIndex: next.stepIndex,
        action,
        sessionKey,
        inputs,
      });
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

  private async executeExecBuiltIn(params: {
    plan: ExecutionPlan;
    stepIndex: number;
    sessionKey: string;
    inputs: PlanExecutionInputs;
    runtime: {
      execCommand?: (args: {
        sessionKey: string;
        command: string;
        cwd?: string;
        timeoutMs?: number;
        background?: boolean;
      }) => Promise<ExecRecoverySession>;
      getJob?: (jobId: string) => Promise<{ status: string; error?: string } | null>;
      pollExec?: (sessionId: string) => Promise<{ status: string; message?: string } | null>;
    };
  }): Promise<PlanExecuteNextResult> {
    const { plan, stepIndex, sessionKey, inputs, runtime } = params;
    if (!runtime.execCommand) {
      return runtimeNotAvailable("exec", plan, stepIndex);
    }
    const normalizedCommand = normalizePlannerExecCommand(inputs.command ?? "");
    const execOutcome = await executeExecWithRecovery({
      sessionKey,
      command: normalizedCommand,
      cwd: inputs.cwd,
      timeoutMs: inputs.timeoutMs,
      background: inputs.background,
      run: runtime.execCommand,
    });
    const exec = execOutcome.exec;
    const execution: PlanStep["execution"] = {
      kind: "exec",
      refId: exec.id,
      status: exec.status,
      command: exec.command,
      startedAt: new Date().toISOString(),
    };

    const finalStatus = toTerminalPlanStatusForExec(exec.status);
    if (finalStatus) {
      const noteParts = [
        `Executor: exec finalizou com status=${exec.status}.`,
        execOutcome.notes.length > 0 ? `Recuperacao: ${execOutcome.notes.join(" | ")}` : "",
        exec.outputTail ? `Output: ${trimTail(exec.outputTail, 240)}` : "",
      ].filter(Boolean);
      const updated = await this.updateStep({
        planId: plan.id,
        stepIndex,
        status: finalStatus,
        notes: noteParts.join(" "),
        execution: {
          ...execution,
          status: exec.status,
        },
      });
      if (finalStatus === "completed") {
        return {
          ok: true,
          plan: updated ?? plan,
          stepIndex,
          action: "exec",
          execution,
        };
      }
      return {
        ok: false,
        reason: "execution_failed",
        message: exec.outputTail?.trim() || `exec terminou com status=${exec.status}`,
        plan: updated ?? plan,
        stepIndex,
        action: "exec",
      };
    }

    const updated = await this.updateStep({
      planId: plan.id,
      stepIndex,
      status: "in_progress",
      notes: `Executor: acao exec disparada.`,
      execution,
    });
    return {
      ok: true,
      plan: updated ?? plan,
      stepIndex,
      action: "exec",
      execution,
    };
  }

  private async executeControlAction(params: {
    plan: ExecutionPlan;
    stepIndex: number;
    action: PlanActionKind;
    sessionKey: string;
    inputs: PlanExecutionInputs;
    runtime: {
      getJob?: (jobId: string) => Promise<{ status: string; error?: string } | null>;
      pollExec?: (sessionId: string) => Promise<{ status: string; message?: string } | null>;
      cancelJob?: (jobId: string) => Promise<{ canceled: boolean; status?: string; message?: string }>;
      cancelExec?: (sessionId: string) => Promise<{ canceled: boolean; status?: string; message?: string }>;
    };
  }): Promise<PlanExecuteNextResult> {
    const { plan, stepIndex, action, sessionKey, inputs, runtime } = params;

    if (action === "wait_execution") {
      return this.executeWaitExecution({ plan, stepIndex, sessionKey, inputs, runtime });
    }

    return this.executeCancelExecution({ plan, stepIndex, sessionKey, inputs, runtime });
  }

  private async executeWaitExecution(params: {
    plan: ExecutionPlan;
    stepIndex: number;
    sessionKey: string;
    inputs: PlanExecutionInputs;
    runtime: {
      getJob?: (jobId: string) => Promise<{ status: string; error?: string } | null>;
      pollExec?: (sessionId: string) => Promise<{ status: string; message?: string } | null>;
    };
  }): Promise<PlanExecuteNextResult> {
    const { plan, stepIndex, inputs, runtime } = params;
    const target = resolveTargetExecution(plan, stepIndex, inputs);
    if (!target) {
      const updated = await this.updateStep({
        planId: plan.id,
        stepIndex,
        status: "blocked",
        notes: "Executor: wait_execution sem execucao alvo (use targetStepIndex ou mantenha um step anterior em andamento).",
      });
      return {
        ok: false,
        reason: "missing_input",
        message: "missing execution target",
        plan: updated ?? plan,
        stepIndex,
        action: "wait_execution",
      };
    }
    const canObserve =
      (target.execution.kind === "job" && Boolean(runtime.getJob)) ||
      (target.execution.kind === "exec" && Boolean(runtime.pollExec));
    if (!canObserve) {
      return runtimeNotAvailable("wait_execution", plan, stepIndex);
    }
    const resolution = await resolveExecutionStatus(target.execution, {
      getJob: runtime.getJob,
      pollExec: runtime.pollExec,
    });
    if (!resolution) {
      const waiting = await this.updateStep({
        planId: plan.id,
        stepIndex,
        status: "in_progress",
        notes: `Executor: aguardando execucao ${target.execution.kind}:${target.execution.refId} finalizar.`,
      });
      return {
        ok: true,
        plan: waiting ?? plan,
        stepIndex,
        action: "wait_execution",
        execution: target.execution,
      };
    }
    if (plan.steps[target.stepIndex]?.status === "in_progress") {
      await this.updateStep({
        planId: plan.id,
        stepIndex: target.stepIndex,
        status: resolution.status,
        notes: `Waiter: execucao ${target.execution.kind}:${target.execution.refId} observada como ${resolution.observedStatus}.`,
        execution: {
          ...target.execution,
          status: resolution.observedStatus,
        },
      });
    }
    const waitStatus = resolution.status;
    const waitResult = await this.updateStep({
      planId: plan.id,
      stepIndex,
      status: waitStatus,
      notes: `Executor: wait_execution finalizado com status=${resolution.observedStatus}.`,
      execution: {
        ...target.execution,
        status: resolution.observedStatus,
      },
    });
    if (waitStatus === "completed") {
      return {
        ok: true,
        plan: waitResult ?? plan,
        stepIndex,
        action: "wait_execution",
        execution: target.execution,
      };
    }
    return {
      ok: false,
      reason: "execution_failed",
      message: `target execution finished with status=${resolution.observedStatus}`,
      plan: waitResult ?? plan,
      stepIndex,
      action: "wait_execution",
    };
  }

  private async executeCancelExecution(params: {
    plan: ExecutionPlan;
    stepIndex: number;
    sessionKey: string;
    inputs: PlanExecutionInputs;
    runtime: {
      cancelJob?: (jobId: string) => Promise<{ canceled: boolean; status?: string; message?: string }>;
      cancelExec?: (sessionId: string) => Promise<{ canceled: boolean; status?: string; message?: string }>;
    };
  }): Promise<PlanExecuteNextResult> {
    const { plan, stepIndex, inputs, runtime } = params;
    const target = resolveTargetExecution(plan, stepIndex, inputs);
    if (!target) {
      const updated = await this.updateStep({
        planId: plan.id,
        stepIndex,
        status: "blocked",
        notes: "Executor: cancel_execution sem execucao alvo (use targetStepIndex ou mantenha um step anterior em andamento).",
      });
      return {
        ok: false,
        reason: "missing_input",
        message: "missing execution target",
        plan: updated ?? plan,
        stepIndex,
        action: "cancel_execution",
      };
    }
    const cancellation =
      target.execution.kind === "job"
        ? runtime.cancelJob
          ? await runtime.cancelJob(target.execution.refId)
          : null
        : runtime.cancelExec
          ? await runtime.cancelExec(target.execution.refId)
          : null;
    if (!cancellation) {
      return runtimeNotAvailable("cancel_execution", plan, stepIndex);
    }
    if (!cancellation.canceled) {
      const failed = await this.updateStep({
        planId: plan.id,
        stepIndex,
        status: "failed",
        notes: `Executor: nao foi possivel cancelar execucao ${target.execution.kind}:${target.execution.refId}.`,
      });
      return {
        ok: false,
        reason: "execution_failed",
        message: cancellation.message ?? "cancel request was not accepted",
        plan: failed ?? plan,
        stepIndex,
        action: "cancel_execution",
      };
    }
    await this.updateStep({
      planId: plan.id,
      stepIndex: target.stepIndex,
      status: "canceled",
      notes: `Canceler: execucao ${target.execution.kind}:${target.execution.refId} cancelada.`,
      execution: {
        ...target.execution,
        status: cancellation.status ?? "canceled",
      },
    });
    const cancelStep = await this.updateStep({
      planId: plan.id,
      stepIndex,
      status: "completed",
      notes: `Executor: cancel_execution concluido para ${target.execution.kind}:${target.execution.refId}.`,
      execution: {
        ...target.execution,
        status: cancellation.status ?? "canceled",
      },
    });
    return {
      ok: true,
      plan: cancelStep ?? plan,
      stepIndex,
      action: "cancel_execution",
      execution: target.execution,
    };
  }

  private async executeRegisteredAction(params: {
    plan: ExecutionPlan;
    stepIndex: number;
    action: PlanActionKind;
    sessionKey: string;
    inputs: PlanExecutionInputs;
  }): Promise<PlanExecuteNextResult> {
    const { plan, stepIndex, action, sessionKey, inputs } = params;
    const handler = this.actionRegistry.get(action);
    if (!handler) {
      return runtimeNotAvailable(action, plan, stepIndex);
    }

    const result = await handler.execute({ sessionKey, inputs });
    if (!result.ok) {
      const updated = await this.updateStep({
        planId: plan.id,
        stepIndex,
        status: "failed",
        notes: `Executor: acao ${action} falhou: ${result.message}`,
      });
      return {
        ok: false,
        reason: "execution_failed",
        message: result.message,
        plan: updated ?? plan,
        stepIndex,
        action,
      };
    }

    const updated = await this.updateStep({
      planId: plan.id,
      stepIndex,
      status: "in_progress",
      notes: `Executor: acao ${action} disparada.`,
      execution: result.execution,
    });
    return {
      ok: true,
      plan: updated ?? plan,
      stepIndex,
      action,
      execution: result.execution,
    };
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

function requiredInputsForAction(kind: string): string[] {
  if (kind === "exec") return ["command"];
  if (kind === "wait_execution" || kind === "cancel_execution") return [];
  return [];
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
  if (
    lower.includes("wait_execution") ||
    lower.includes("aguardar execucao") ||
    lower.includes("aguardar execução") ||
    lower.includes("esperar execucao") ||
    lower.includes("esperar execução")
  ) {
    return { title, action: createAction("wait_execution") };
  }
  if (
    lower.includes("cancel_execution") ||
    lower.includes("cancelar execucao") ||
    lower.includes("cancelar execução")
  ) {
    return { title, action: createAction("cancel_execution") };
  }

  return { title, action: createAction("exec") };
}

function isControlAction(kind: PlanActionKind): boolean {
  return kind === "wait_execution" || kind === "cancel_execution";
}

function findPendingControlStepForInProgressExecution(
  plan: ExecutionPlan,
): { stepIndex: number; step: PlanStep } | null {
  for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex += 1) {
    const step = plan.steps[stepIndex];
    if (step.status !== "in_progress" || !step.execution) {
      continue;
    }
    for (let candidateIndex = stepIndex + 1; candidateIndex < plan.steps.length; candidateIndex += 1) {
      const candidate = plan.steps[candidateIndex];
      if (candidate.status !== "pending" || !isControlAction(candidate.action.kind)) {
        if (candidate.status === "pending") {
          break;
        }
        continue;
      }
      const targetStepIndexRaw = candidate.action.params.targetStepIndex;
      const targetStepIndex =
        typeof targetStepIndexRaw === "number" && Number.isFinite(targetStepIndexRaw)
          ? Math.floor(targetStepIndexRaw)
          : null;
      if (targetStepIndex !== null && targetStepIndex !== stepIndex) {
        continue;
      }
      return { stepIndex: candidateIndex, step: candidate };
    }
  }
  return null;
}

function resolveTargetExecution(
  plan: ExecutionPlan,
  currentStepIndex: number,
  inputs: PlanExecutionInputs,
): { stepIndex: number; execution: NonNullable<PlanStep["execution"]> } | null {
  const fromInputRaw = inputs.targetStepIndex;
  const fromInput = typeof fromInputRaw === "number" && Number.isFinite(fromInputRaw) ? Math.floor(fromInputRaw) : null;
  if (fromInput !== null && fromInput >= 0 && fromInput < plan.steps.length) {
    const target = plan.steps[fromInput];
    if (target.execution) {
      return { stepIndex: fromInput, execution: target.execution };
    }
  }
  for (let index = currentStepIndex - 1; index >= 0; index -= 1) {
    const step = plan.steps[index];
    if (step.status === "in_progress" && step.execution) {
      return { stepIndex: index, execution: step.execution };
    }
  }
  for (let index = currentStepIndex - 1; index >= 0; index -= 1) {
    const step = plan.steps[index];
    if (step.execution) {
      return { stepIndex: index, execution: step.execution };
    }
  }
  return null;
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

function normalizePlannerExecCommand(command: string): string {
  const raw = command.trim();
  if (!raw) {
    return raw;
  }

  if (!/python\d*\s+-\s+<<['"]?PY['"]?/i.test(raw) && !/os\.environ\.get\(/i.test(raw)) {
    return raw;
  }

  const envRefs = new Set<string>();
  for (const match of raw.matchAll(/os\.environ\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g)) {
    if (match[1]) {
      envRefs.add(match[1]);
    }
  }
  if (envRefs.size === 0) {
    return raw;
  }

  const assigned = new Set<string>();
  for (const match of raw.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)=/gm)) {
    if (match[1]) {
      assigned.add(match[1]);
    }
  }

  const alreadyExported = new Set<string>();
  for (const match of raw.matchAll(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
    if (match[1]) {
      alreadyExported.add(match[1]);
    }
  }

  const needed = [...envRefs].filter((name) => assigned.has(name) && !alreadyExported.has(name));
  if (needed.length === 0) {
    return raw;
  }

  const exportBlock = needed.map((name) => `export ${name}`).join("\n");
  return `${exportBlock}\n${raw}`;
}

type ExecRecoverySession = {
  id: string;
  status: string;
  command: string;
  cwd: string;
  outputTail?: string;
  exitCode?: number | null;
};

async function executeExecWithRecovery(params: {
  sessionKey: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  background?: boolean;
  run: (args: {
    sessionKey: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
    background?: boolean;
  }) => Promise<ExecRecoverySession>;
}): Promise<{ exec: ExecRecoverySession; notes: string[] }> {
  const notes: string[] = [];
  let currentCommand = params.command;
  let last = await params.run({
    sessionKey: params.sessionKey,
    command: currentCommand,
    cwd: params.cwd,
    timeoutMs: params.timeoutMs,
    background: params.background,
  });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const failure = classifyExecFailure(last);
    if (!failure.retryable) {
      return { exec: last, notes };
    }

    const recovered = buildExecRecoveryCommand({
      originalCommand: params.command,
      lastCommand: currentCommand,
      outputTail: last.outputTail ?? "",
      attempt,
    });
    if (!recovered) {
      return { exec: last, notes };
    }

    notes.push(`tentativa ${attempt + 1}: ${recovered.reason}`);
    currentCommand = recovered.command;
    last = await params.run({
      sessionKey: params.sessionKey,
      command: currentCommand,
      cwd: params.cwd,
      timeoutMs: params.timeoutMs,
      background: params.background,
    });
  }

  return { exec: last, notes };
}

function classifyExecFailure(exec: ExecRecoverySession): { retryable: boolean; reason: string } {
  const status = (exec.status || "").toLowerCase();
  if (status === "completed" || status === "running" || status === "approval-pending") {
    return { retryable: false, reason: "status_ok" };
  }
  if (status === "denied" || status === "canceled") {
    return { retryable: false, reason: "operator_or_policy" };
  }
  const output = (exec.outputTail ?? "").toLowerCase();
  if (output.includes("could not resolve host")) {
    return { retryable: true, reason: "dns_resolution_failed" };
  }
  if (output.includes("timed out") || output.includes("timeout")) {
    return { retryable: true, reason: "timeout" };
  }
  if (output.includes("invalid data found when processing input")) {
    return { retryable: true, reason: "invalid_media_payload" };
  }
  if (output.includes("temporary failure") || output.includes("connection reset")) {
    return { retryable: true, reason: "transient_network" };
  }
  return { retryable: false, reason: "non_retryable_failure" };
}

function buildExecRecoveryCommand(params: {
  originalCommand: string;
  lastCommand: string;
  outputTail: string;
  attempt: number;
}): { command: string; reason: string } | null {
  const output = params.outputTail.toLowerCase();
  if (output.includes("could not resolve host")) {
    return {
      reason: "repetir download com pausa curta para resolver falha transiente de DNS",
      command: `sleep 1\n${params.originalCommand}`,
    };
  }

  if (
    output.includes("invalid data found when processing input") &&
    params.lastCommand.toLowerCase().includes("ffprobe") &&
    params.lastCommand.includes("/tmp/first_segment.bin")
  ) {
    const repair = [
      "set -euo pipefail",
      "if [ -f /tmp/first_segment.bin ] && head -c 16 /tmp/first_segment.bin | grep -q '#EXTM3U'; then",
      "  PLAY='/tmp/first_segment.bin'",
      '  BASE_URL="$(cat /tmp/first_segment_url.txt | sed \'s|[^/]*$||\')"',
      '  MAP_REF="$(grep -m1 \'^#EXT-X-MAP:\' "$PLAY" | sed -E \'s/.*URI="([^"]+)".*/\\1/\' || true)"',
      '  SEG_REF="$(grep -vE \'^\\s*#\' "$PLAY" | head -n 1 | tr -d \'\\r\' || true)"',
      '  [ -n "$SEG_REF" ] && curl -fsSL -L "${BASE_URL}${SEG_REF}" -o /tmp/_kael_seg.bin',
      '  if [ -n "$MAP_REF" ]; then',
      '    curl -fsSL -L "${BASE_URL}${MAP_REF}" -o /tmp/_kael_init.bin',
      '    cat /tmp/_kael_init.bin /tmp/_kael_seg.bin > /tmp/first_segment.bin',
      '  elif [ -f /tmp/_kael_seg.bin ]; then',
      '    mv /tmp/_kael_seg.bin /tmp/first_segment.bin',
      "  fi",
      "fi",
      params.originalCommand,
    ].join("\n");
    return {
      reason: "reconstruir first_segment.bin quando veio playlist em vez de segmento bruto",
      command: repair,
    };
  }

  if (output.includes("timed out") || output.includes("timeout")) {
    return {
      reason: "repetir comando com timeout maior para concluir etapa",
      command: `${params.originalCommand}`,
    };
  }

  return null;
}

function toTerminalPlanStatusForExec(statusRaw: string): PlanStepStatus | null {
  const status = statusRaw.toLowerCase();
  if (status === "completed") {
    return "completed";
  }
  if (status === "failed" || status === "timed_out" || status === "denied") {
    return "failed";
  }
  if (status === "canceled") {
    return "canceled";
  }
  return null;
}

function trimTail(value: string, maxChars = 240): string {
  if (!value) {
    return "";
  }
  return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}
