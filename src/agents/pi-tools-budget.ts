import { isInteractionActionRaw } from "./tool-specs/browser.js";
import { textResult } from "./pi-tools-telemetry.js";

type BlockedToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: {
    blocked: true;
    reason: string;
    status: "blocked";
    retryAfterMs?: number;
  };
};

export function makeBlockedResult(params: {
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

export function createToolBudget(params: {
  budget?: {
    maxToolCalls?: number;
    maxExecCalls?: number;
    maxStreamerCalls?: number;
    maxWebFetchCalls?: number;
    maxWebSearchCalls?: number;
    maxWebResearchCalls?: number;
    maxMcpCalls?: number;
    maxEdgeCalls?: number;
    maxBrowserCalls?: number;
    maxBrowserInteractionCalls?: number;
  };
  onBlocked?: (event: { tool: string; reason: string }) => void;
}) {
  let toolCalls = 0;
  let execCalls = 0;
  let streamerCalls = 0;
  let webFetchCalls = 0;
  let webSearchCalls = 0;
  let webResearchCalls = 0;
  let mcpCalls = 0;
  let edgeCalls = 0;
  let browserCalls = 0;
  let browserInteractionCalls = 0;
  let imageGenerateCalls = 0;

  const maxToolCalls = Math.max(1, Math.floor(params.budget?.maxToolCalls ?? 12));
  const maxExecCalls = Math.max(1, Math.floor(params.budget?.maxExecCalls ?? 6));
  const maxStreamerCalls = Math.max(1, Math.floor(params.budget?.maxStreamerCalls ?? 8));
  const maxWebFetchCalls = Math.max(1, Math.floor(params.budget?.maxWebFetchCalls ?? 5));
  const maxWebSearchCalls = Math.max(1, Math.floor(params.budget?.maxWebSearchCalls ?? 3));
  const maxWebResearchCalls = Math.max(1, Math.floor(params.budget?.maxWebResearchCalls ?? 2));
  const maxMcpCalls = Math.max(1, Math.floor(params.budget?.maxMcpCalls ?? 4));
  const maxEdgeCalls = Math.max(1, Math.floor(params.budget?.maxEdgeCalls ?? 4));
  const maxBrowserCalls = Math.max(1, Math.floor(params.budget?.maxBrowserCalls ?? 8));
  const maxBrowserInteractionCalls = Math.max(1, Math.floor(params.budget?.maxBrowserInteractionCalls ?? 6));
  const maxImageGenerateCalls = 1;

  const blockByBudget = (paramsInput: {
    tool: string;
    reason: string;
    nextAction?: string;
  }): BlockedToolResult => {
    params.onBlocked?.({ tool: paramsInput.tool, reason: paramsInput.reason });
    return makeBlockedResult({
      reason: paramsInput.reason,
      nextAction: paramsInput.nextAction,
    });
  };

  const reserveToolCall = (tool: string): { blocked: BlockedToolResult } | null => {
    if (toolCalls >= maxToolCalls) {
      const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
      return { blocked: blockByBudget({ tool, reason }) };
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
      return { blocked: blockByBudget({ tool: "browser", reason }) };
    }
    const isInteractionAction = isInteractionActionRaw(actionRaw);
    if (isInteractionAction && browserInteractionCalls >= maxBrowserInteractionCalls) {
      const reason = `browser_interaction_budget_exceeded:${browserInteractionCalls}/${maxBrowserInteractionCalls}`;
      return { blocked: blockByBudget({ tool: "browser", reason }) };
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
      return { blocked: blockByBudget({ tool, reason, nextAction: "finalize_answer_with_available_evidence" }) };
    }
    if (tool === "web_search" && webSearchCalls >= maxWebSearchCalls) {
      const reason = `web_search_budget_exceeded:${webSearchCalls}/${maxWebSearchCalls}`;
      return { blocked: blockByBudget({ tool, reason, nextAction: "finalize_answer_with_available_evidence" }) };
    }
    if (tool === "web_fetch" && webFetchCalls >= maxWebFetchCalls) {
      const reason = `web_fetch_budget_exceeded:${webFetchCalls}/${maxWebFetchCalls}`;
      return { blocked: blockByBudget({ tool, reason, nextAction: "finalize_answer_with_available_evidence" }) };
    }
    if (tool === "web_research" && webResearchCalls >= maxWebResearchCalls) {
      const reason = `web_research_budget_exceeded:${webResearchCalls}/${maxWebResearchCalls}`;
      return { blocked: blockByBudget({ tool, reason, nextAction: "finalize_answer_with_available_evidence" }) };
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
      return { blocked: blockByBudget({ tool: "exec", reason }) };
    }
    if (execCalls >= maxExecCalls) {
      const reason = `exec_call_budget_exceeded:${execCalls}/${maxExecCalls}`;
      return { blocked: blockByBudget({ tool: "exec", reason }) };
    }
    toolCalls += 1;
    execCalls += 1;
    return null;
  };

  const reserveProcessCall = (): { blocked: BlockedToolResult } | null => {
    const reserved = reserveToolCall("process");
    return reserved ? { blocked: reserved.blocked } : null;
  };

  const reserveStreamerCall = (): { blocked: BlockedToolResult } | null => {
    if (toolCalls >= maxToolCalls) {
      const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
      return { blocked: blockByBudget({ tool: "streamer", reason }) };
    }
    if (streamerCalls >= maxStreamerCalls) {
      const reason = `streamer_budget_exceeded:${streamerCalls}/${maxStreamerCalls}`;
      return { blocked: blockByBudget({ tool: "streamer", reason }) };
    }
    toolCalls += 1;
    streamerCalls += 1;
    return null;
  };

  const reserveImageCall = (): { blocked: BlockedToolResult } | null => {
    if (toolCalls >= maxToolCalls) {
      const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
      return { blocked: blockByBudget({ tool: "image_generate", reason }) };
    }
    if (imageGenerateCalls >= maxImageGenerateCalls) {
      const reason = `image_generate_budget_exceeded:${imageGenerateCalls}/${maxImageGenerateCalls}`;
      return { blocked: blockByBudget({ tool: "image_generate", reason }) };
    }
    toolCalls += 1;
    imageGenerateCalls += 1;
    return null;
  };

  const reserveMcpCall = (): { blocked: BlockedToolResult } | null => {
    if (toolCalls >= maxToolCalls) {
      const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
      return { blocked: blockByBudget({ tool: "mcp_call", reason }) };
    }
    if (mcpCalls >= maxMcpCalls) {
      const reason = `mcp_call_budget_exceeded:${mcpCalls}/${maxMcpCalls}`;
      return { blocked: blockByBudget({ tool: "mcp_call", reason }) };
    }
    toolCalls += 1;
    mcpCalls += 1;
    return null;
  };

  const reserveEdgeCall = (): { blocked: BlockedToolResult } | null => {
    if (toolCalls >= maxToolCalls) {
      const reason = `tool_call_budget_exceeded:${toolCalls}/${maxToolCalls}`;
      return { blocked: blockByBudget({ tool: "edge_call", reason }) };
    }
    if (edgeCalls >= maxEdgeCalls) {
      const reason = `edge_call_budget_exceeded:${edgeCalls}/${maxEdgeCalls}`;
      return { blocked: blockByBudget({ tool: "edge_call", reason }) };
    }
    toolCalls += 1;
    edgeCalls += 1;
    return null;
  };

  return {
    makeBlockedResult,
    reserveToolCall,
    reserveBrowserCall,
    reserveWebCall,
    reserveExecCall,
    reserveProcessCall,
    reserveStreamerCall,
    reserveImageCall,
    reserveMcpCall,
    reserveEdgeCall,
  };
}
