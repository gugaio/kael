import type { AgentTool } from "@mariozechner/pi-agent-core";
import { kaelLogger } from "../infra/logger.js";
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
  trace?: {
    turnId: string;
    attempt: number;
    requestId?: string;
    goal?: string;
  };
  budget?: {
    maxToolCalls?: number;
    maxExecCalls?: number;
  };
  onToolEvent?: (event: {
    phase: "start" | "end";
    tool: string;
    status?: string;
    blocked?: boolean;
    reason?: string;
  }) => void;
}): AgentTool[] {
  let toolCalls = 0;
  let execCalls = 0;
  const maxToolCalls = Math.max(1, Math.floor(params.budget?.maxToolCalls ?? 12));
  const maxExecCalls = Math.max(1, Math.floor(params.budget?.maxExecCalls ?? 6));

  const inferIntent = (tool: "exec" | "process", rawParams: unknown): string => {
    if (tool === "process") {
      const action =
        rawParams && typeof rawParams === "object"
          ? String((rawParams as { action?: unknown }).action ?? "")
          : "";
      return action ? `process:${action}` : "process:unknown";
    }
    const command =
      rawParams && typeof rawParams === "object"
        ? String((rawParams as { command?: unknown }).command ?? "").toLowerCase()
        : "";
    if (!command) return "exec:unknown";
    if (command.includes("ffprobe")) return "exec:media_probe";
    if (command.includes("ffmpeg")) return "exec:media_transform";
    if (command.includes("curl") || command.includes("wget")) return "exec:network_fetch";
    if (command.includes("python") || command.includes("node")) return "exec:script_run";
    if (command.includes("ls") || command.includes("cat") || command.includes("find")) return "exec:file_inspect";
    return "exec:generic";
  };

  const logToolStart = (tool: "exec" | "process", rawParams: unknown): string => {
    const intent = inferIntent(tool, rawParams);
    kaelLogger.info("pi.tool.call.started", {
      turnId: params.trace?.turnId ?? null,
      attempt: params.trace?.attempt ?? null,
      requestId: params.trace?.requestId ?? null,
      sessionKey: params.sessionKey,
      tool,
      intent,
      goal: params.trace?.goal ? params.trace.goal.slice(0, 180) : null,
    });
    params.onToolEvent?.({ phase: "start", tool });
    return intent;
  };

  const logToolEnd = (
    tool: "exec" | "process",
    intent: string,
    result: unknown,
    startedAtMs: number,
  ): void => {
    const typed = (result ?? {}) as { status?: unknown; blocked?: unknown; reason?: unknown };
    const status = typeof typed.status === "string" ? typed.status : "unknown";
    const blocked = typed.blocked === true;
    const reason = typeof typed.reason === "string" ? typed.reason : undefined;
    kaelLogger.info("pi.tool.call.finished", {
      turnId: params.trace?.turnId ?? null,
      attempt: params.trace?.attempt ?? null,
      requestId: params.trace?.requestId ?? null,
      sessionKey: params.sessionKey,
      tool,
      intent,
      status,
      blocked,
      reason,
      durationMs: Date.now() - startedAtMs,
    });
    params.onToolEvent?.({ phase: "end", tool, status, blocked, reason });
  };

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
      if (toolCalls >= maxToolCalls) {
        const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
        params.onToolEvent?.({ phase: "end", tool: "exec", status: "blocked", blocked: true, reason });
        return {
          content: textResult(`blocked=true\nreason=${reason}`),
          details: { blocked: true, reason, status: "blocked" },
        };
      }
      if (execCalls >= maxExecCalls) {
        const reason = `exec_call_budget_exceeded:${execCalls}/${maxExecCalls}`;
        params.onToolEvent?.({ phase: "end", tool: "exec", status: "blocked", blocked: true, reason });
        return {
          content: textResult(`blocked=true\nreason=${reason}`),
          details: { blocked: true, reason, status: "blocked" },
        };
      }
      toolCalls += 1;
      execCalls += 1;
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        command: string;
        cwd?: string;
        timeoutMs?: number;
        background?: boolean;
        security?: "deny" | "allowlist" | "full";
        ask?: "off" | "on-miss" | "always";
      };
      const intent = logToolStart("exec", args);
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "exec",
        params: args,
      });
      if (decision && !decision.allowed) {
        const blockedResult = {
          content: textResult(
            `blocked=true\nreason=${decision.reason}\nretryAfterMs=${decision.retryAfterMs}`,
          ),
          details: {
            blocked: true,
            reason: decision.reason,
            retryAfterMs: decision.retryAfterMs,
          },
        };
        logToolEnd("exec", intent, blockedResult.details, startedAtMs);
        return blockedResult;
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

      const result = {
        content: textResult(formatSession(session)),
        details: session,
      };
      logToolEnd("exec", intent, session, startedAtMs);
      return result;
    },
  };

  const processTool: AgentTool = {
    name: "process",
    label: "Process",
    description:
      "Gerencia sessoes de execucao shell. Acoes: list, poll, log, kill e remove.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "poll", "log", "kill", "remove"],
          description: "Acao da sessao",
        },
        sessionId: {
          type: "string",
          description: "ID da sessao para poll/log/kill/remove",
        },
        offset: { type: "number", description: "Offset de leitura para action=log" },
        limit: { type: "number", description: "Limite de caracteres para action=log" },
      },
      required: ["action"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      if (toolCalls >= maxToolCalls) {
        const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
        params.onToolEvent?.({ phase: "end", tool: "process", status: "blocked", blocked: true, reason });
        return {
          content: textResult(`blocked=true\nreason=${reason}`),
          details: { blocked: true, reason, status: "blocked" },
        };
      }
      toolCalls += 1;
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        action: "list" | "poll" | "log" | "kill" | "remove";
        sessionId?: string;
        offset?: number;
        limit?: number;
      };
      const intent = logToolStart("process", args);
      const decision = params.loopGuard?.beforeCall({
        sessionKey: params.sessionKey,
        tool: "process",
        params: args,
      });
      if (decision && !decision.allowed) {
        const blockedResult = {
          content: textResult(
            `blocked=true\nreason=${decision.reason}\nretryAfterMs=${decision.retryAfterMs}`,
          ),
          details: {
            blocked: true,
            reason: decision.reason,
            retryAfterMs: decision.retryAfterMs,
          },
        };
        logToolEnd("process", intent, blockedResult.details, startedAtMs);
        return blockedResult;
      }
      const result = await params.tooling.processCommand({
        sessionKey: params.sessionKey,
        action: args.action,
        sessionId: args.sessionId,
        offset: args.offset,
        limit: args.limit,
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
          : args.action === "log"
            ? [
                `ok=${result.ok}`,
                result.message ? `message=${result.message}` : "",
                result.output ? `output:\n${result.output}` : "",
              ]
                .filter(Boolean)
                .join("\n")
          : [
              `ok=${result.ok}`,
              result.message ? `message=${result.message}` : "",
              result.session ? formatSession(result.session) : "",
            ]
              .filter(Boolean)
              .join("\n");

      const toolResult = {
        content: textResult(text),
        details: result,
      };
      logToolEnd("process", intent, result, startedAtMs);
      return toolResult;
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

  const workspaceSearchTool: AgentTool = {
    name: "workspace_search",
    label: "Workspace Search",
    description:
      "Busca texto no workspace do Kael (docs, src, config) para responder perguntas sobre arquitetura e implementacao atual.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto a localizar no workspace" },
        maxResults: { type: "number", description: "Quantidade maxima de ocorrencias" },
      },
      required: ["query"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { query: string; maxResults?: number };
      const hits = await params.tooling.workspaceSearch({
        query: args.query,
        maxResults: args.maxResults,
      });
      const text =
        hits.length === 0
          ? "hits=0"
          : [`hits=${hits.length}`, ...hits.map((hit, i) => `${i + 1}. ${hit.path}:${hit.line} ${hit.snippet}`)].join(
              "\n",
            );
      return {
        content: textResult(text),
        details: { hits },
      };
    },
  };

  const workspaceReadTool: AgentTool = {
    name: "workspace_read",
    label: "Workspace Read",
    description:
      "Le trecho de arquivo do workspace (somente leitura) para confirmar detalhes do proprio Kael com evidencias.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relativo ao workspace" },
        from: { type: "number", description: "Linha inicial (1-based)" },
        lines: { type: "number", description: "Quantidade de linhas" },
      },
      required: ["path"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { path: string; from?: number; lines?: number };
      const result = await params.tooling.workspaceRead({
        path: args.path,
        from: args.from,
        lines: args.lines,
      });
      return {
        content: textResult(`${result.path}#L${result.startLine}-L${result.endLine}\n${result.text}`),
        details: result,
      };
    },
  };

  const webSearchTool: AgentTool = {
    name: "web_search",
    label: "Web Search",
    description:
      "Pesquisa na web com citacao de fontes. Use para fatos atuais, confirmacao externa e comparacao de opcoes.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Consulta de pesquisa" },
        maxResults: { type: "number", description: "Quantidade maxima de fontes" },
        recencyDays: { type: "number", description: "Recencia em dias (opcional)" },
        domainsAllow: { type: "array", items: { type: "string" } },
        domainsBlock: { type: "array", items: { type: "string" } },
      },
      required: ["query"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as {
        query: string;
        maxResults?: number;
        recencyDays?: number;
        domainsAllow?: string[];
        domainsBlock?: string[];
      };
      const result = await params.tooling.webSearch({
        sessionKey: params.sessionKey,
        query: args.query,
        maxResults: args.maxResults,
        recencyDays: args.recencyDays,
        domainsAllow: args.domainsAllow,
        domainsBlock: args.domainsBlock,
      });
      const text = [
        `sources=${result.sources.length}`,
        "answer:",
        result.answer,
        "",
        "sources_list:",
        ...result.sources.map((item, idx) => `${idx + 1}. ${item.title} | ${item.url}`),
        ...(result.notes.length > 0 ? ["", "notes:", ...result.notes.map((item) => `- ${item}`)] : []),
      ].join("\n");
      return {
        content: textResult(text),
        details: result,
      };
    },
  };

  const webFetchTool: AgentTool = {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Baixa uma URL e extrai texto limpo para leitura resumida. Use para aprofundar uma fonte do web_search.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL http/https para extrair conteudo" },
        maxChars: { type: "number", description: "Limite maximo de caracteres de conteudo" },
      },
      required: ["url"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as { url: string; maxChars?: number };
      const result = await params.tooling.webFetch({
        sessionKey: params.sessionKey,
        url: args.url,
        maxChars: args.maxChars,
      });
      const text = [
        `url=${result.url}`,
        `finalUrl=${result.finalUrl}`,
        `cached=${result.cached}`,
        result.title ? `title=${result.title}` : "",
        result.contentType ? `contentType=${result.contentType}` : "",
        "excerpt:",
        result.excerpt,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content: textResult(text),
        details: result,
      };
    },
  };

  const webResearchTool: AgentTool = {
    name: "web_research",
    label: "Web Research",
    description:
      "Executa pesquisa completa (search + fetch de fontes) e retorna resumo com evidencias e nivel de confianca.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Pergunta/tema de pesquisa" },
        maxResults: { type: "number", description: "Quantidade maxima de fontes de busca" },
        fetchTop: { type: "number", description: "Quantidade de fontes para web_fetch automatico" },
        fetchMaxChars: { type: "number", description: "Limite de texto por fonte fetched" },
        recencyDays: { type: "number", description: "Recencia em dias (opcional)" },
        domainsAllow: { type: "array", items: { type: "string" } },
        domainsBlock: { type: "array", items: { type: "string" } },
      },
      required: ["query"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      const args = (rawParams ?? {}) as {
        query: string;
        maxResults?: number;
        fetchTop?: number;
        fetchMaxChars?: number;
        recencyDays?: number;
        domainsAllow?: string[];
        domainsBlock?: string[];
      };
      const result = await params.tooling.webResearch({
        sessionKey: params.sessionKey,
        query: args.query,
        maxResults: args.maxResults,
        fetchTop: args.fetchTop,
        fetchMaxChars: args.fetchMaxChars,
        recencyDays: args.recencyDays,
        domainsAllow: args.domainsAllow,
        domainsBlock: args.domainsBlock,
      });
      const text = [
        `confidence=${result.confidence}`,
        `confidenceReason=${result.confidenceReason}`,
        "",
        "summary:",
        result.summary,
        "",
        "evidence:",
        ...result.evidence
          .slice(0, 6)
          .map(
            (item, idx) =>
              `${idx + 1}. ${item.source.title} | ${item.source.url}${item.fetch ? " | fetched=true" : ""}`,
          ),
        ...(result.notes.length > 0 ? ["", "notes:", ...result.notes.map((item) => `- ${item}`)] : []),
      ].join("\n");
      return {
        content: textResult(text),
        details: result,
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
        content: textResult(text),
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
        content: textResult(
          `scannedPlans=${result.scannedPlans}\nupdatedPlans=${result.updatedPlans}\nupdatedSteps=${result.updatedSteps}`,
        ),
        details: result,
      };
    },
  };

  return [
    execTool,
    processTool,
    memorySearchTool,
    memoryGetTool,
    memoryWriteTool,
    workspaceSearchTool,
    workspaceReadTool,
    webSearchTool,
    webFetchTool,
    webResearchTool,
    planCreateTool,
    planGenerateTool,
    planListTool,
    planUpdateStepTool,
    planNextTool,
    planExecuteNextTool,
    planReconcileTool,
  ];
}
