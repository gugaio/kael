import type { AgentTool } from "@mariozechner/pi-agent-core";
import { kaelLogger } from "../infra/logger.js";
import { createBrowserPiTool, isInteractionActionRaw } from "./tool-specs/browser.js";
import { createJobsPiTools } from "./tool-specs/jobs.js";
import { createMemoryPiTools } from "./tool-specs/memory.js";
import { createVideoPiTools } from "./tool-specs/video.js";
import { createWebPiTools } from "./tool-specs/web.js";
import { createWorkspacePiTools } from "./tool-specs/workspace.js";
import type { EngineOutputArtifact, EngineTooling } from "./types.js";
import type { ToolLoopGuard } from "./tool-loop-guard.js";

type TextBlock = {
  type: "text";
  text: string;
};

function textResult(text: string) {
  return [{ type: "text", text } satisfies TextBlock];
}

type BlockedToolResult = {
  content: TextBlock[];
  details: {
    blocked: true;
    reason: string;
    status: "blocked";
    retryAfterMs?: number;
  };
};

function makeBlockedResult(params: {
  reason: string;
  retryAfterMs?: number;
  nextAction?: string;
}): BlockedToolResult {
  const lines = [`blocked=true`, `reason=${params.reason}`];
  if (typeof params.retryAfterMs === "number") {
    lines.push(`retryAfterMs=${params.retryAfterMs}`);
  }
  if (params.nextAction) {
    lines.push(`nextAction=${params.nextAction}`);
  }
  return {
    content: textResult(lines.join("\n")),
    details: {
      blocked: true,
      reason: params.reason,
      status: "blocked",
      ...(typeof params.retryAfterMs === "number" ? { retryAfterMs: params.retryAfterMs } : {}),
    },
  };
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
  turnSignal?: AbortSignal;
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
    maxWebFetchCalls?: number;
    maxWebSearchCalls?: number;
    maxWebResearchCalls?: number;
    maxBrowserCalls?: number;
    maxBrowserInteractionCalls?: number;
  };
  onToolEvent?: (event: {
    phase: "start" | "end";
    tool: string;
    status?: string;
    blocked?: boolean;
    reason?: string;
    summary?: string;
    artifact?: EngineOutputArtifact;
  }) => void;
}): AgentTool[] {
  let toolCalls = 0;
  let execCalls = 0;
  let webFetchCalls = 0;
  let webSearchCalls = 0;
  let webResearchCalls = 0;
  let browserCalls = 0;
  let browserInteractionCalls = 0;
  let imageGenerateCalls = 0;
  const maxToolCalls = Math.max(1, Math.floor(params.budget?.maxToolCalls ?? 12));
  const maxExecCalls = Math.max(1, Math.floor(params.budget?.maxExecCalls ?? 6));
  const maxWebFetchCalls = Math.max(1, Math.floor(params.budget?.maxWebFetchCalls ?? 5));
  const maxWebSearchCalls = Math.max(1, Math.floor(params.budget?.maxWebSearchCalls ?? 3));
  const maxWebResearchCalls = Math.max(1, Math.floor(params.budget?.maxWebResearchCalls ?? 2));
  const maxBrowserCalls = Math.max(1, Math.floor(params.budget?.maxBrowserCalls ?? 8));
  const maxBrowserInteractionCalls = Math.max(1, Math.floor(params.budget?.maxBrowserInteractionCalls ?? 6));
  const maxImageGenerateCalls = 1;

  const inferIntent = (tool: string, rawParams: unknown): string => {
    if (tool === "memory_search") return "memory:search";
    if (tool === "memory_get") return "memory:get";
    if (tool === "memory_write") return "memory:write";
    if (tool === "process") {
      const action =
        rawParams && typeof rawParams === "object"
          ? String((rawParams as { action?: unknown }).action ?? "")
          : "";
      return action ? `process:${action}` : "process:unknown";
    }
    if (tool === "video_hls_inspect") {
      return "video:hls_inspect";
    }
    if (tool === "video_probe") {
      return "video:probe";
    }
    if (tool === "web_search") {
      return "web:search";
    }
    if (tool === "web_fetch") {
      return "web:fetch";
    }
    if (tool === "web_research") {
      return "web:research";
    }
    if (tool === "browser") {
      const action =
        rawParams && typeof rawParams === "object"
          ? String((rawParams as { action?: unknown }).action ?? "")
          : "";
      return action ? `browser:${action}` : "browser:unknown";
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

  const logToolStart = (tool: string, rawParams: unknown): string => {
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
    tool: string,
    intent: string,
    result: unknown,
    startedAtMs: number,
    summary?: string,
    artifact?: EngineOutputArtifact,
  ): void => {
    const typed = (result ?? {}) as {
      status?: unknown;
      blocked?: unknown;
      reason?: unknown;
      resultCount?: unknown;
      topPaths?: unknown;
      path?: unknown;
    };
    const status = typeof typed.status === "string" ? typed.status : "unknown";
    const blocked = typed.blocked === true;
    const reason = typeof typed.reason === "string" ? typed.reason : undefined;
    const error = typeof (typed as { error?: unknown }).error === "string"
      ? (typed as { error: string }).error
      : undefined;
    const resultCount = typeof typed.resultCount === "number" ? typed.resultCount : undefined;
    const topPaths = Array.isArray(typed.topPaths)
      ? typed.topPaths.filter((v): v is string => typeof v === "string").slice(0, 5)
      : undefined;
    const path = typeof typed.path === "string" ? typed.path : undefined;
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
      error,
      resultCount,
      topPaths,
      path,
      summary: summary ? summary.slice(0, 220) : undefined,
      durationMs: Date.now() - startedAtMs,
    });
    params.onToolEvent?.({ phase: "end", tool, status, blocked, reason, summary, artifact });
  };

  const blockByBudget = (paramsInput: {
    tool: string;
    reason: string;
    emitEvent?: boolean;
    nextAction?: string;
  }): BlockedToolResult => {
    if (paramsInput.emitEvent) {
      params.onToolEvent?.({
        phase: "end",
        tool: paramsInput.tool,
        status: "blocked",
        blocked: true,
        reason: paramsInput.reason,
      });
    }
    return makeBlockedResult({
      reason: paramsInput.reason,
      nextAction: paramsInput.nextAction,
    });
  };

  const reserveToolCall = (tool: string): { blocked: BlockedToolResult } | null => {
    if (toolCalls >= maxToolCalls) {
      const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
      return { blocked: blockByBudget({ tool, reason, emitEvent: true }) };
    }
    toolCalls += 1;
    return null;
  };

  const reserveBrowserCall = (actionRaw: string): { blocked: BlockedToolResult } | null => {
    const generic = reserveToolCall("browser");
    if (generic) {
      return generic;
    }
    if (browserCalls >= maxBrowserCalls) {
      const reason = `browser_budget_exceeded:${browserCalls}/${maxBrowserCalls}`;
      return { blocked: blockByBudget({ tool: "browser", reason, emitEvent: true }) };
    }
    const isInteractionAction = isInteractionActionRaw(actionRaw);
    if (isInteractionAction && browserInteractionCalls >= maxBrowserInteractionCalls) {
      const reason =
        `browser_interaction_budget_exceeded:${browserInteractionCalls}/${maxBrowserInteractionCalls}`;
      return { blocked: blockByBudget({ tool: "browser", reason, emitEvent: true }) };
    }
    browserCalls += 1;
    if (isInteractionAction) {
      browserInteractionCalls += 1;
    }
    return null;
  };

  const reserveWebCall = (
    tool: "web_search" | "web_fetch" | "web_research",
  ): { blocked: BlockedToolResult } | null => {
    if (toolCalls >= maxToolCalls) {
      const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
      return {
        blocked: blockByBudget({
          tool,
          reason,
          emitEvent: true,
          nextAction: "finalize_answer_with_available_evidence",
        }),
      };
    }
    if (tool === "web_search" && webSearchCalls >= maxWebSearchCalls) {
      const reason = `web_search_budget_exceeded:${webSearchCalls}/${maxWebSearchCalls}`;
      return {
        blocked: blockByBudget({
          tool,
          reason,
          emitEvent: true,
          nextAction: "finalize_answer_with_available_evidence",
        }),
      };
    }
    if (tool === "web_fetch" && webFetchCalls >= maxWebFetchCalls) {
      const reason = `web_fetch_budget_exceeded:${webFetchCalls}/${maxWebFetchCalls}`;
      return {
        blocked: blockByBudget({
          tool,
          reason,
          emitEvent: true,
          nextAction: "finalize_answer_with_available_evidence",
        }),
      };
    }
    if (tool === "web_research" && webResearchCalls >= maxWebResearchCalls) {
      const reason = `web_research_budget_exceeded:${webResearchCalls}/${maxWebResearchCalls}`;
      return {
        blocked: blockByBudget({
          tool,
          reason,
          emitEvent: true,
          nextAction: "finalize_answer_with_available_evidence",
        }),
      };
    }
    toolCalls += 1;
    if (tool === "web_search") {
      webSearchCalls += 1;
    } else if (tool === "web_fetch") {
      webFetchCalls += 1;
    } else {
      webResearchCalls += 1;
    }
    return null;
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
        return blockByBudget({ tool: "exec", reason, emitEvent: true });
      }
      if (execCalls >= maxExecCalls) {
        const reason = `exec_call_budget_exceeded:${execCalls}/${maxExecCalls}`;
        return blockByBudget({ tool: "exec", reason, emitEvent: true });
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
        const blockedResult = makeBlockedResult({
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
        });
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
        return blockByBudget({ tool: "process", reason, emitEvent: true });
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
        const blockedResult = makeBlockedResult({
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
        });
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

  const [videoHlsInspectTool, videoProbeTool] = createVideoPiTools({
    sessionKey: params.sessionKey,
    tooling: params.tooling,
    textResult,
    reserveToolCall,
    logToolStart,
    logToolEnd: (tool, intent, result, startedAtMs, summary) =>
      logToolEnd(tool, intent, result, startedAtMs, summary),
  });

  const [jobsListTool, jobsGetTool, jobsLogTailTool] = createJobsPiTools({
    tooling: params.tooling,
    textResult,
    reserveToolCall,
    logToolStart,
    logToolEnd: (tool, intent, result, startedAtMs, summary) =>
      logToolEnd(tool, intent, result, startedAtMs, summary),
  });

  const [memorySearchTool, memoryGetTool, memoryWriteTool] = createMemoryPiTools({
    tooling: params.tooling,
    textResult,
    logToolStart,
    logToolEnd: (tool, intent, result, startedAtMs, summary) =>
      logToolEnd(tool, intent, result, startedAtMs, summary),
  });

  const [workspaceSearchTool, workspaceReadTool] = createWorkspacePiTools({
    tooling: params.tooling,
    textResult,
  });

  const [webSearchTool, webFetchTool, webResearchTool] = createWebPiTools({
    sessionKey: params.sessionKey,
    tooling: params.tooling,
    turnSignal: params.turnSignal,
    loopGuard: params.loopGuard,
    textResult,
    makeBlockedResult,
    reserveWebCall,
    logToolStart,
    logToolEnd: (tool, intent, result, startedAtMs, summary) =>
      logToolEnd(tool, intent, result, startedAtMs, summary),
  });

  const browserTool = createBrowserPiTool({
    sessionKey: params.sessionKey,
    tooling: params.tooling,
    textResult,
    reserveBrowserCall,
    logToolStart,
    logToolEnd: (tool, intent, result, startedAtMs, summary) =>
      logToolEnd(tool, intent, result, startedAtMs, summary),
  });

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
        content: textResult(text),
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
          content: textResult("found=false"),
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
        content: textResult(text),
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

  const imageGenerateTool: AgentTool = {
    name: "image_generate",
    label: "Image Generate",
    description:
      "Gera uma imagem a partir de prompt e retorna referencia para envio em canais que suportam anexo.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Descricao da imagem a gerar" },
        size: {
          type: "string",
          enum: ["1024x1024", "1536x1024", "1024x1536"],
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    } as unknown as AgentTool["parameters"],
    execute: async (_toolCallId, rawParams) => {
      if (toolCalls >= maxToolCalls) {
        const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
        return blockByBudget({ tool: "image_generate", reason, emitEvent: true });
      }
      if (imageGenerateCalls >= maxImageGenerateCalls) {
        const reason = `image_generate_budget_exceeded:${imageGenerateCalls}/${maxImageGenerateCalls}`;
        return blockByBudget({ tool: "image_generate", reason, emitEvent: true });
      }
      toolCalls += 1;
      imageGenerateCalls += 1;
      const startedAtMs = Date.now();
      const args = (rawParams ?? {}) as {
        prompt: string;
        size?: "1024x1024" | "1536x1024" | "1024x1536";
      };
      const intent = logToolStart("image_generate", args);
      if (!params.tooling.imageGenerate) {
        const reason = "image_generate_unavailable";
        const details = makeBlockedResult({ reason }).details;
        logToolEnd("image_generate", intent, details, startedAtMs);
        return {
          content: textResult(`blocked=true\nreason=${reason}`),
          details,
        };
      }
      try {
        const artifact = await params.tooling.imageGenerate({
          sessionKey: params.sessionKey,
          prompt: args.prompt,
          size: args.size,
        });
        const details = {
          status: "completed",
          kind: artifact.kind,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
        };
        logToolEnd(
          "image_generate",
          intent,
          details,
          startedAtMs,
          `image_generated file=${artifact.fileName} mime=${artifact.mimeType}`,
          artifact,
        );
        return {
          content: textResult(`ok=true\nimage_generated=${artifact.fileName}\nmime=${artifact.mimeType}`),
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details = {
          status: "failed",
          blocked: false,
          reason: "image_generate_failed",
          error: message,
        };
        logToolEnd("image_generate", intent, details, startedAtMs, `image_generate_failed error=${message}`);
        return {
          content: textResult(`ok=false\nreason=image_generate_failed\nerror=${message}`),
          details,
        };
      }
    },
  };

  return [
    execTool,
    processTool,
    videoHlsInspectTool,
    videoProbeTool,
    jobsListTool,
    jobsGetTool,
    jobsLogTailTool,
    memorySearchTool,
    memoryGetTool,
    memoryWriteTool,
    workspaceSearchTool,
    workspaceReadTool,
    webSearchTool,
    webFetchTool,
    webResearchTool,
    browserTool,
    imageGenerateTool,
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
