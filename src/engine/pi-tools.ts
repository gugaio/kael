import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EngineTooling } from "./types.js";
import type { ToolLoopGuard } from "./tool-loop-guard.js";

type TextBlock = {
  type: "text";
  text: string;
};

function textResult(text: string) {
  return [{ type: "text", text } satisfies TextBlock];
}

function formatSession(session: {
  id: string;
  status: string;
  command: string;
  outputTail?: string;
  approvalId?: string;
}): string {
  const lines = [`session=${session.id}`, `status=${session.status}`, `command=${session.command}`];
  if (session.approvalId) {
    lines.push(`approvalId=${session.approvalId}`);
  }
  if (session.outputTail && session.outputTail.trim()) {
    lines.push(`output:\n${session.outputTail}`);
  }
  return lines.join("\n");
}

export function createPiShellTools(params: {
  sessionKey: string;
  tooling: EngineTooling;
  loopGuard?: ToolLoopGuard;
}): AgentTool[] {
  const execTool: AgentTool = {
    name: "exec",
    label: "Exec",
    description:
      "Executa comando shell local. Suporta background, timeout, policy de seguranca e aprovacao. Para encerrar sessoes iniciadas por exec, prefira a tool process com action=kill.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Comando shell a executar" },
        cwd: { type: "string", description: "Diretorio relativo ao workspace" },
        timeoutMs: { type: "number", description: "Timeout em milissegundos" },
        background: { type: "boolean", description: "Executa em background" },
        security: {
          type: "string",
          enum: ["deny", "allowlist", "full"],
          description: "Override temporario de politica de seguranca",
        },
        ask: {
          type: "string",
          enum: ["off", "on-miss", "always"],
          description: "Override temporario de politica de aprovacao",
        },
      },
      required: ["command"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as {
        command: string;
        cwd?: string;
        timeoutMs?: number;
        background?: boolean;
        security?: "deny" | "allowlist" | "full";
        ask?: "off" | "on-miss" | "always";
      };
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "exec",
        params: args,
      });
      if (decision && !decision.allowed) {
        return {
          content: textResult(
            `blocked=true\nreason=${decision.reason}\nretryAfterMs=${decision.retryAfterMs}`,
          ),
          details: {
            blocked: true,
            reason: decision.reason,
            retryAfterMs: decision.retryAfterMs,
          },
        };
      }

      const session = await params.tooling.execCommand({
        sessionKey: params.sessionKey,
        command: args.command,
        cwd: args.cwd,
        timeoutMs: args.timeoutMs,
        background: args.background,
        security: args.security,
        ask: args.ask,
      });
      params.loopGuard?.afterCall({
        sessionKey: params.sessionKey,
        tool: "exec",
        params: args,
        result: session,
      });

      return {
        content: textResult(formatSession(session)),
        details: session,
      };
    },
  };

  const processTool: AgentTool = {
    name: "process",
    label: "Process",
    description:
      "Gerencia sessoes de execucao shell. Acoes: list, poll e kill. Use action=kill como primeira opcao para parar comandos iniciados por exec.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "poll", "kill"],
          description: "Acao da sessao",
        },
        sessionId: {
          type: "string",
          description: "ID da sessao para poll/kill",
        },
      },
      required: ["action"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as {
        action: "list" | "poll" | "kill";
        sessionId?: string;
      };
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "process",
        params: args,
      });
      if (decision && !decision.allowed) {
        return {
          content: textResult(
            `blocked=true\nreason=${decision.reason}\nretryAfterMs=${decision.retryAfterMs}`,
          ),
          details: {
            blocked: true,
            reason: decision.reason,
            retryAfterMs: decision.retryAfterMs,
          },
        };
      }
      const result = await params.tooling.processCommand({
        sessionKey: params.sessionKey,
        action: args.action,
        sessionId: args.sessionId,
      });
      params.loopGuard?.afterCall({
        sessionKey: params.sessionKey,
        tool: "process",
        params: args,
        result,
      });

      const text =
        args.action === "list"
          ? `ok=${result.ok}\nsessions=${(result.sessions ?? []).length}`
          : [
              `ok=${result.ok}`,
              result.message ? `message=${result.message}` : "",
              result.session ? formatSession(result.session) : "",
            ]
              .filter(Boolean)
              .join("\n");

      return {
        content: textResult(text),
        details: result,
      };
    },
  };

  const memorySearchTool: AgentTool = {
    name: "memory_search",
    label: "Memory Search",
    description:
      "Busca semantica simplificada em MEMORY.md e memory/*.md. Use antes de responder sobre fatos, decisoes, preferencias e tarefas passadas.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Consulta de memoria" },
        maxResults: { type: "number", description: "Quantidade maxima de snippets" },
      },
      required: ["query"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { query: string; maxResults?: number };
      const results = await params.tooling.memorySearch({
        query: args.query,
        maxResults: args.maxResults,
      });
      const text =
        results.length === 0
          ? "results=0"
          : [
              `results=${results.length}`,
              ...results.map(
                (item, idx) =>
                  `${idx + 1}. ${item.path}#L${item.startLine}-L${item.endLine} score=${item.score}\n${item.snippet}`,
              ),
            ].join("\n\n");
      return {
        content: textResult(text),
        details: { results },
      };
    },
  };

  const memoryGetTool: AgentTool = {
    name: "memory_get",
    label: "Memory Get",
    description: "Le trecho de MEMORY.md ou memory/*.md por path e opcionalmente intervalo de linhas.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relativo (MEMORY.md ou memory/*.md)" },
        from: { type: "number", description: "Linha inicial (1-based)" },
        lines: { type: "number", description: "Quantidade de linhas" },
      },
      required: ["path"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { path: string; from?: number; lines?: number };
      const result = await params.tooling.memoryGet({
        path: args.path,
        from: args.from,
        lines: args.lines,
      });
      const text = `${result.path}#L${result.startLine}-L${result.endLine}\n${result.text}`;
      return {
        content: textResult(text),
        details: result,
      };
    },
  };

  const memoryWriteTool: AgentTool = {
    name: "memory_write",
    label: "Memory Write",
    description:
      "Persiste memoria operacional. target=daily para notas do dia; target=long_term para decisoes/preferencias duraveis.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Conteudo a persistir" },
        target: {
          type: "string",
          enum: ["daily", "long_term"],
          description: "Destino da memoria",
        },
      },
      required: ["content"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { content: string; target?: "daily" | "long_term" };
      const saved = await params.tooling.memoryWrite({
        content: args.content,
        target: args.target,
      });
      return {
        content: textResult(`saved=true\npath=${saved.path}`),
        details: saved,
      };
    },
  };

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
        content: textResult(`planId=${plan.id}\nstatus=${plan.status}\nsteps=${plan.steps.length}`),
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
        status?: "active" | "completed" | "blocked" | "failed" | "canceled";
        limit?: number;
      };
      const plans = params.tooling.planList({
        sessionKey: params.sessionKey,
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
        content: textResult(text),
        details: { plans },
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
          content: textResult("ok=false\nreason=plan_or_step_not_found"),
          details: { ok: false },
        };
      }
      return {
        content: textResult(`ok=true\nplanId=${updated.id}\nplanStatus=${updated.status}`),
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
          content: textResult("next=none"),
          details: { next: null },
        };
      }
      return {
        content: textResult(
          `stepIndex=${next.stepIndex}\nstatus=${next.step.status}\ntitle=${next.step.title}`,
        ),
        details: next,
      };
    },
  };

  return [
    execTool,
    processTool,
    memorySearchTool,
    memoryGetTool,
    memoryWriteTool,
    planCreateTool,
    planListTool,
    planUpdateStepTool,
    planNextTool,
  ];
}
