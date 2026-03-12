import type { AgentTool } from "@mariozechner/pi-agent-core";
import { kaelLogger } from "../infra/logger.js";
import { createPiCapabilityTools } from "./tool-specs/index.js";
import { isInteractionActionRaw } from "./tool-specs/browser.js";
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
    maxMcpCalls?: number;
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
  let mcpCalls = 0;
  let browserCalls = 0;
  let browserInteractionCalls = 0;
  let imageGenerateCalls = 0;
  const maxToolCalls = Math.max(1, Math.floor(params.budget?.maxToolCalls ?? 12));
  const maxExecCalls = Math.max(1, Math.floor(params.budget?.maxExecCalls ?? 6));
  const maxWebFetchCalls = Math.max(1, Math.floor(params.budget?.maxWebFetchCalls ?? 5));
  const maxWebSearchCalls = Math.max(1, Math.floor(params.budget?.maxWebSearchCalls ?? 3));
  const maxWebResearchCalls = Math.max(1, Math.floor(params.budget?.maxWebResearchCalls ?? 2));
  const maxMcpCalls = Math.max(1, Math.floor((params.budget as { maxMcpCalls?: number } | undefined)?.maxMcpCalls ?? 4));
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
    if (tool === "mcp_list") {
      return "mcp:list";
    }
    if (tool === "mcp_call") {
      const target =
        rawParams && typeof rawParams === "object"
          ? String((rawParams as { target?: unknown }).target ?? "")
          : "";
      return target ? `mcp:call:${target}` : "mcp:call";
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

  const reserveExecCall = (): { blocked: BlockedToolResult } | null => {
    if (toolCalls >= maxToolCalls) {
      const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
      return { blocked: blockByBudget({ tool: "exec", reason, emitEvent: true }) };
    }
    if (execCalls >= maxExecCalls) {
      const reason = `exec_call_budget_exceeded:${execCalls}/${maxExecCalls}`;
      return { blocked: blockByBudget({ tool: "exec", reason, emitEvent: true }) };
    }
    toolCalls += 1;
    execCalls += 1;
    return null;
  };

  const reserveProcessCall = (): { blocked: BlockedToolResult } | null => {
    const reserved = reserveToolCall("process");
    if (reserved) {
      return { blocked: reserved.blocked };
    }
    return null;
  };

  const reserveImageCall = (): { blocked: BlockedToolResult } | null => {
    if (toolCalls >= maxToolCalls) {
      const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
      return { blocked: blockByBudget({ tool: "image_generate", reason, emitEvent: true }) };
    }
    if (imageGenerateCalls >= maxImageGenerateCalls) {
      const reason = `image_generate_budget_exceeded:${imageGenerateCalls}/${maxImageGenerateCalls}`;
      return { blocked: blockByBudget({ tool: "image_generate", reason, emitEvent: true }) };
    }
    toolCalls += 1;
    imageGenerateCalls += 1;
    return null;
  };

  const reserveMcpCall = (): { blocked: BlockedToolResult } | null => {
    if (toolCalls >= maxToolCalls) {
      const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
      return { blocked: blockByBudget({ tool: "mcp_call", reason, emitEvent: true }) };
    }
    if (mcpCalls >= maxMcpCalls) {
      const reason = `mcp_call_budget_exceeded:${mcpCalls}/${maxMcpCalls}`;
      return { blocked: blockByBudget({ tool: "mcp_call", reason, emitEvent: true }) };
    }
    toolCalls += 1;
    mcpCalls += 1;
    return null;
  };

  const capabilityTools = createPiCapabilityTools({
    system: {
      sessionKey: params.sessionKey,
      tooling: params.tooling,
      loopGuard: params.loopGuard,
      textResult,
      formatSession,
      makeBlockedResult,
      reserveExecCall,
      reserveProcessCall,
      logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    video: {
      sessionKey: params.sessionKey,
      tooling: params.tooling,
      textResult,
      reserveToolCall,
      logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    jobs: {
      tooling: params.tooling,
      textResult,
      reserveToolCall,
      logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    mcp: {
      sessionKey: params.sessionKey,
      tooling: params.tooling,
      loopGuard: params.loopGuard,
      textResult,
      makeBlockedResult,
      reserveMcpCall,
      logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    memory: {
      tooling: params.tooling,
      textResult,
      logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    workspace: {
      tooling: params.tooling,
      textResult,
    },
    web: {
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
    },
    browser: {
      sessionKey: params.sessionKey,
      tooling: params.tooling,
      textResult,
      reserveBrowserCall,
      logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    plans: {
      sessionKey: params.sessionKey,
      tooling: params.tooling,
      textResult,
    },
    image: {
      sessionKey: params.sessionKey,
      tooling: params.tooling,
      textResult,
      makeBlockedResult,
      reserveImageCall,
      logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary, artifact) =>
        logToolEnd(tool, intent, result, startedAtMs, summary, artifact),
    },
  });

  const [execTool, processTool] = capabilityTools.system;
  const [videoHlsInspectTool, videoProbeTool] = capabilityTools.video;
  const [jobsListTool, jobsGetTool, jobsLogTailTool] = capabilityTools.jobs;
  const [mcpListTool, mcpCallTool] = capabilityTools.mcp;
  const [memorySearchTool, memoryGetTool, memoryWriteTool] = capabilityTools.memory;
  const [workspaceSearchTool, workspaceReadTool] = capabilityTools.workspace;
  const [webSearchTool, webFetchTool, webResearchTool] = capabilityTools.web;
  const browserTool = capabilityTools.browser;
  const [
    planCreateTool,
    planGenerateTool,
    planListTool,
    planGetTool,
    planUpdateStepTool,
    planNextTool,
    planExecuteNextTool,
    planReconcileTool,
  ] = capabilityTools.plans;
  const imageGenerateTool = capabilityTools.image;

  return [
    execTool,
    processTool,
    videoHlsInspectTool,
    videoProbeTool,
    jobsListTool,
    jobsGetTool,
    jobsLogTailTool,
    mcpListTool,
    mcpCallTool,
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
