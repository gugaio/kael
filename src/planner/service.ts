import crypto from "node:crypto";
import path from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../infra/fs.js";

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
export type PlanStatus = "active" | "completed" | "blocked" | "failed" | "canceled";

export type PlanStep = {
  id: string;
  title: string;
  status: PlanStepStatus;
  notes?: string;
  updatedAt: string;
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

export class PlannerService {
  private readonly plansPath: string;
  private plans = new Map<string, ExecutionPlan>();

  constructor(dataDir: string) {
    this.plansPath = path.join(dataDir, "plans", "plans.json");
  }

  async init(): Promise<void> {
    await ensureDir(path.dirname(this.plansPath));
    const loaded = await readJsonFile<PlannerStore>(this.plansPath, { plans: {} });
    this.plans = new Map(Object.entries(loaded.plans));
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

  async updateStep(params: {
    planId: string;
    stepIndex: number;
    status: PlanStepStatus;
    notes?: string;
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
    steps[params.stepIndex] = {
      ...step,
      status: params.status,
      notes: params.notes?.trim() || step.notes,
      updatedAt: now,
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
