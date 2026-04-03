import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createPiCapabilityTools } from "./tool-specs/index.js";
import type { EngineOutputArtifact, EngineToolingNamespaces } from "./types.js";
import type { ToolLoopGuard } from "./tool-loop-guard.js";
import { createToolBudget } from "./pi-tools-budget.js";
import { createToolTelemetry, formatSession, textResult } from "./pi-tools-telemetry.js";

export function createPiShellTools(params: {
  sessionKey: string;
  tooling: EngineToolingNamespaces;
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
    maxEdgeCalls?: number;
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
  const telemetry = createToolTelemetry({
    sessionKey: params.sessionKey,
    trace: params.trace,
    onToolEvent: params.onToolEvent,
  });
  const budget = createToolBudget({
    budget: params.budget,
    onBlocked: ({ tool, reason }) => {
      params.onToolEvent?.({
        phase: "end",
        tool,
        status: "blocked",
        blocked: true,
        reason,
      });
    },
  });

  const capabilityTools = createPiCapabilityTools({
    system: {
      sessionKey: params.sessionKey,
      tooling: params.tooling.system,
      loopGuard: params.loopGuard,
      textResult,
      formatSession,
      makeBlockedResult: budget.makeBlockedResult,
      reserveExecCall: budget.reserveExecCall,
      reserveProcessCall: budget.reserveProcessCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    video: {
      sessionKey: params.sessionKey,
      tooling: params.tooling.video,
      textResult,
      reserveToolCall: budget.reserveToolCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    jobs: {
      tooling: params.tooling.jobs,
      textResult,
      reserveToolCall: budget.reserveToolCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    edge: {
      tooling: params.tooling.edge,
      textResult,
      makeBlockedResult: budget.makeBlockedResult,
      reserveEdgeCall: budget.reserveEdgeCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    mcp: {
      sessionKey: params.sessionKey,
      tooling: params.tooling.mcp,
      loopGuard: params.loopGuard,
      textResult,
      makeBlockedResult: budget.makeBlockedResult,
      reserveMcpCall: budget.reserveMcpCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    memory: {
      tooling: params.tooling.memory,
      textResult,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    workspace: {
      tooling: params.tooling.workspace,
      textResult,
    },
    web: {
      sessionKey: params.sessionKey,
      tooling: params.tooling.web,
      turnSignal: params.turnSignal,
      loopGuard: params.loopGuard,
      textResult,
      makeBlockedResult: budget.makeBlockedResult,
      reserveWebCall: budget.reserveWebCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    browser: {
      sessionKey: params.sessionKey,
      tooling: params.tooling.browser,
      textResult,
      reserveBrowserCall: budget.reserveBrowserCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    plans: {
      sessionKey: params.sessionKey,
      tooling: params.tooling.plans,
      textResult,
    },
    image: {
      sessionKey: params.sessionKey,
      tooling: params.tooling.image,
      textResult,
      makeBlockedResult: budget.makeBlockedResult,
      reserveImageCall: budget.reserveImageCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary, artifact) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary, artifact),
    },
  });

  const [execTool, processTool] = capabilityTools.system;
  const [videoHlsInspectTool, videoProbeTool, videoManifestAuditTool, playbackAnalyzeTool] = capabilityTools.video;
  const [jobsListTool, jobsGetTool, jobsLogTailTool] = capabilityTools.jobs;
  const [
    edgeListTool,
    edgeCallTool,
    youboraMetricsGetTool,
    youboraRawdataGetTool,
    youboraEventsGetTool,
  ] = capabilityTools.edge;
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
    videoManifestAuditTool,
    playbackAnalyzeTool,
    jobsListTool,
    jobsGetTool,
    jobsLogTailTool,
    edgeListTool,
    edgeCallTool,
    youboraMetricsGetTool,
    youboraRawdataGetTool,
    youboraEventsGetTool,
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
