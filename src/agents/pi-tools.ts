import type { AgentTool } from "@mariozechner/pi-agent-core";
import { buildPiTools } from "../tools/pi/index.js";
import type { AgentContext } from "./context.js";
import type { EngineOutputArtifact } from "./types.js";
import type { ToolLoopGuard } from "./tool-loop-guard.js";
import { createToolBudget } from "./pi-tools-budget.js";
import { createToolTelemetry, formatSession, textResult } from "./pi-tools-telemetry.js";

export function createPiTools(params: {
  sessionKey: string;
  context: AgentContext;
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
    maxStreamerCalls?: number;
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

  const _tools = buildPiTools({
    system: {
      sessionKey: params.sessionKey,
      shell: params.context.runtimes.shell,
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
      videoInspect: params.context.video.inspect,
      playbackTriage: params.context.video.playbackTriage,
      streamMonitor: params.context.video.streamMonitor,
      streamer: params.context.video.streamer,
      investigations: params.context.video.investigations,
      serveManager: params.context.video.serveManager,
      textResult,
      reserveToolCall: budget.reserveToolCall,
      reserveStreamerCall: budget.reserveStreamerCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    jobs: {
      jobs: params.context.video.jobs,
      textResult,
      reserveToolCall: budget.reserveToolCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    edge: {
      edge: params.context.runtimes.edge,
      textResult,
      makeBlockedResult: budget.makeBlockedResult,
      reserveEdgeCall: budget.reserveEdgeCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    mcp: {
      sessionKey: params.sessionKey,
      mcp: params.context.runtimes.mcp,
      loopGuard: params.loopGuard,
      textResult,
      makeBlockedResult: budget.makeBlockedResult,
      reserveMcpCall: budget.reserveMcpCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    memory: {
      memory: params.context.services.memory,
      textResult,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    workspace: {
      workspace: params.context.services.workspace,
      textResult,
    },
    web: {
      sessionKey: params.sessionKey,
      research: params.context.services.research,
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
      browser: params.context.runtimes.browser,
      textResult,
      reserveBrowserCall: budget.reserveBrowserCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary),
    },
    plans: {
      sessionKey: params.sessionKey,
      planner: params.context.services.planner,
      jobs: params.context.video.jobs,
      shell: params.context.runtimes.shell,
      textResult,
    },
    image: {
      sessionKey: params.sessionKey,
      imageGenerator: params.context.generation.image,
      textResult,
      makeBlockedResult: budget.makeBlockedResult,
      reserveImageCall: budget.reserveImageCall,
      logToolStart: telemetry.logToolStart,
      logToolEnd: (tool, intent, result, startedAtMs, summary, artifact) =>
        telemetry.logToolEnd(tool, intent, result, startedAtMs, summary, artifact),
    },
  });

  const [execTool, processTool] = _tools.system;
  const [
    videoHlsInspectTool,
    videoProbeTool,
    playbackAnalyzeTool,
    ...streamerTools
  ] = _tools.video;
  const [jobsListTool, jobsGetTool, jobsLogTailTool] = _tools.jobs;
  const [
    edgeListTool,
    edgeCallTool,
    youboraMetricsGetTool,
    youboraRawdataGetTool,
    youboraEventsGetTool,
  ] = _tools.edge;
  const [mcpListTool, mcpCallTool] = _tools.mcp;
  const [memorySearchTool, memoryGetTool, memoryWriteTool] = _tools.memory;
  const [workspaceSearchTool, workspaceReadTool] = _tools.workspace;
  const [webSearchTool, webFetchTool, webResearchTool] = _tools.web;
  const browserTool = _tools.browser;
  const [
    planCreateTool,
    planGenerateTool,
    planListTool,
    planGetTool,
    planUpdateStepTool,
    planNextTool,
    planExecuteNextTool,
    planReconcileTool,
  ] = _tools.plans;
  const imageGenerateTool = _tools.image;

  return [
    execTool,
    processTool,
    videoHlsInspectTool,
    videoProbeTool,
    playbackAnalyzeTool,
    ...streamerTools,
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
