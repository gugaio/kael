import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineTooling } from "../types.js";

type TextBlock = {
  type: "text";
  text: string;
};

export function createPlanPiTools(params: {
  sessionKey: string;
  tooling: EngineTooling;
  textResult: (text: string) => TextBlock[];
}): AgentTool[] {
  const planCreateTool: AgentTool = {
    name: "plan_create",
    label: "Plan Create",
    description: "Cria um plano persistente com passos executaveis para a sessao atual.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titulo do plano" },
        steps: { type: "array", items: { type: "string" }, description: "Lista de passos" },
      },
      required: ["title", "steps"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { title: string; steps: string[] };
      const plan = await params.tooling.planCreate({
        sessionKey: params.sessionKey,
        title: args.title,
        steps: Array.isArray(args.steps) ? args.steps : [],
      });
      return {
        content: params.textResult(`planId=${plan.id}\nstatus=${plan.status}\nsteps=${plan.steps.length}`),
        details: plan,
      };
    },
  };

  const planGenerateTool: AgentTool = {
    name: "plan_generate",
    label: "Plan Generate",
    description: "Gera automaticamente um plano executavel a partir de um objetivo.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "Objetivo em linguagem natural" },
        maxSteps: { type: "number", description: "Limite de etapas no plano" },
      },
      required: ["objective"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { objective: string; maxSteps?: number };
      const plan = await params.tooling.planGenerate({
        sessionKey: params.sessionKey,
        objective: args.objective,
        maxSteps: args.maxSteps,
      });
      return {
        content: params.textResult(`planId=${plan.id}\nstatus=${plan.status}\nsteps=${plan.steps.length}`),
        details: plan,
      };
    },
  };

  const planListTool: AgentTool = {
    name: "plan_list",
    label: "Plan List",
    description: "Lista planos por sessao/status.",
    parameters: {
      type: "object",
      properties: {
        sessionKey: { type: "string" },
        status: {
          type: "string",
          enum: ["active", "completed", "blocked", "failed", "canceled"],
        },
        limit: { type: "number" },
      },
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as {
        sessionKey?: string;
        status?: "active" | "completed" | "blocked" | "failed" | "canceled";
        limit?: number;
      };
      const plans = params.tooling.planList({
        sessionKey: args.sessionKey,
        status: args.status,
        limit: args.limit,
      });
      const text =
        plans.length === 0
          ? "plans=0"
          : [
              `plans=${plans.length}`,
              ...plans.map((plan) => `${plan.id} | ${plan.status} | ${plan.title} | steps=${plan.steps.length}`),
            ].join("\n");
      return {
        content: params.textResult(text),
        details: { plans },
      };
    },
  };

  const planGetTool: AgentTool = {
    name: "plan_get",
    label: "Plan Get",
    description: "Retorna detalhes completos de um plano por id.",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string" },
      },
      required: ["planId"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { planId: string };
      const plan = params.tooling.planGet({ planId: args.planId });
      if (!plan) {
        return {
          content: params.textResult("found=false"),
          details: { found: false, planId: args.planId },
        };
      }
      const text = [
        "found=true",
        `planId=${plan.id}`,
        `sessionKey=${plan.sessionKey}`,
        `status=${plan.status}`,
        `title=${plan.title}`,
        `steps=${plan.steps.length}`,
      ].join("\n");
      return {
        content: params.textResult(text),
        details: { found: true, plan },
      };
    },
  };

  const planUpdateStepTool: AgentTool = {
    name: "plan_update_step",
    label: "Plan Update Step",
    description: "Atualiza status de um passo do plano.",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string" },
        stepIndex: { type: "number" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "blocked", "failed", "canceled"],
        },
        notes: { type: "string" },
      },
      required: ["planId", "stepIndex", "status"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as {
        planId: string;
        stepIndex: number;
        status: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
        notes?: string;
      };
      const updated = await params.tooling.planUpdateStep({
        planId: args.planId,
        stepIndex: Math.floor(args.stepIndex),
        status: args.status,
        notes: args.notes,
      });
      if (!updated) {
        return {
          content: params.textResult("ok=false\nreason=plan_or_step_not_found"),
          details: { ok: false },
        };
      }
      return {
        content: params.textResult(`ok=true\nplanId=${updated.id}\nplanStatus=${updated.status}`),
        details: updated,
      };
    },
  };

  const planNextTool: AgentTool = {
    name: "plan_next",
    label: "Plan Next",
    description: "Retorna o proximo passo executavel (pending/in_progress).",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string" },
      },
      required: ["planId"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { planId: string };
      const next = params.tooling.planNextAction({ planId: args.planId });
      if (!next) {
        return {
          content: params.textResult("next=none"),
          details: { next: null },
        };
      }
      return {
        content: params.textResult(
          `stepIndex=${next.stepIndex}\nstatus=${next.step.status}\ntitle=${next.step.title}`,
        ),
        details: next,
      };
    },
  };

  const planExecuteNextTool: AgentTool = {
    name: "plan_execute_next",
    label: "Plan Execute Next",
    description:
      "Executa o proximo passo pending/in_progress do plano usando runtime local (jobs/exec).",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string" },
        inputs: {
          type: "object",
          properties: {
            inputPath: { type: "string" },
            outputPath: { type: "string" },
            outputPlaylistPath: { type: "string" },
            streamUrl: { type: "string" },
            durationSeconds: { type: "number" },
            segmentTime: { type: "number" },
            args: { type: "array", items: { type: "string" } },
            command: { type: "string" },
            cwd: { type: "string" },
            timeoutMs: { type: "number" },
            background: { type: "boolean" },
            targetStepIndex: { type: "number" },
          },
          additionalProperties: false,
        },
      },
      required: ["planId"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as {
        planId: string;
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
      const result = await params.tooling.planExecuteNext({
        planId: args.planId,
        inputs: args.inputs,
      });
      const text = [
        `ok=${result.ok}`,
        result.reason ? `reason=${result.reason}` : "",
        result.action ? `action=${result.action}` : "",
        result.stepIndex !== undefined ? `stepIndex=${result.stepIndex}` : "",
        result.execution ? `execution=${result.execution.kind}:${result.execution.refId}` : "",
        result.message ? `message=${result.message}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content: params.textResult(text),
        details: result,
      };
    },
  };

  const planReconcileTool: AgentTool = {
    name: "plan_reconcile",
    label: "Plan Reconcile",
    description: "Reconcilia steps em andamento com status final de jobs/exec.",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { planId?: string; limit?: number };
      const result = await params.tooling.planReconcile({
        planId: args.planId,
        limit: args.limit,
      });
      return {
        content: params.textResult(
          `scannedPlans=${result.scannedPlans}\nupdatedPlans=${result.updatedPlans}\nupdatedSteps=${result.updatedSteps}`,
        ),
        details: result,
      };
    },
  };

  return [
    planCreateTool,
    planGenerateTool,
    planListTool,
    planGetTool,
    planUpdateStepTool,
    planNextTool,
    planExecuteNextTool,
    planReconcileTool,
  ];
}

