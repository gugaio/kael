import type { JobRecord } from "../types.js";
import type { WebFetchResult, WebResearchResult, WebSearchResult } from "../research/types.js";
import type {
  BrowserCommandAction,
  BrowserCommandResult,
  BrowserRuntimeTelemetry,
} from "../capabilities/browser/index.js";
import type { PlaybackAnalysisReport, PlaybackEvent, PlaybackEngine } from "../capabilities/video/index.js";
import type { McpCallResult, McpListResult } from "../tools/mcp/mcp-bridge-service.js";
import type { EdgeCallResult, EdgeCapabilitySummary } from "../edge/runtime.js";

export type EngineTooling = {
  startTranscode: (params: {
    sessionKey: string;
    inputPath: string;
    outputPath: string;
    args?: string[];
  }) => Promise<JobRecord>;
  startConvertHls: (params: {
    sessionKey: string;
    inputPath: string;
    outputPlaylistPath: string;
    segmentTime?: number;
  }) => Promise<JobRecord>;
  startCaptureStream: (params: {
    sessionKey: string;
    streamUrl: string;
    outputPath: string;
    durationSeconds?: number;
  }) => Promise<JobRecord>;
  startProbeMedia: (params: {
    sessionKey: string;
    inputPath: string;
  }) => Promise<JobRecord>;
  startPlayVlc?: (params: {
    sessionKey: string;
    input: string;
  }) => Promise<JobRecord>;
  videoHlsInspect: (params: {
    sessionKey: string;
    url: string;
    maxSegments?: number;
    timeoutMs?: number;
  }) => Promise<{
    ok: boolean;
    url: string;
    finalUrl: string;
    playlistType: "master" | "media" | "unknown";
    variants: Array<{
      uri: string;
      url: string;
      bandwidth?: number;
      averageBandwidth?: number;
      resolution?: string;
      frameRate?: number;
      codecs?: string;
      audioGroupId?: string;
      subtitlesGroupId?: string;
    }>;
    renditions: Array<{
      type: string;
      groupId?: string;
      name?: string;
      language?: string;
      default?: boolean;
      autoselect?: boolean;
      forced?: boolean;
      uri?: string;
      url?: string;
    }>;
    segments: Array<{
      uri: string;
      url: string;
      duration?: number;
      title?: string;
    }>;
    targetDuration?: number;
    mediaSequence?: number;
    errors: string[];
  }>;
  videoProbe: (params: {
    sessionKey: string;
    input: string;
    timeoutMs?: number;
    keyframes?: boolean;
    maxKeyframes?: number;
    streamSelector?: string;
  }) => Promise<{
    ok: boolean;
    input: string;
    timeoutMs: number;
    format?: unknown;
    streams?: unknown[];
    keyframes?: {
      streamSelector: string;
      count: number;
      timestamps: number[];
    };
    errors: string[];
  }>;
  listJobs: (params?: {
    sessionKey?: string;
    capability?: string;
    action?: string;
    status?: string;
    limit?: number;
  }) => {
    id: string;
    capability: string;
    action: string;
    status: string;
    output?: string;
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
    error?: string;
  }[];
  getJob: (params: { jobId: string }) => {
    id: string;
    capability: string;
    action: string;
    status: string;
    sessionKey: string;
    command: string;
    input: string;
    output?: string;
    args: string[];
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
    exitCode?: number | null;
    error?: string;
    logPath: string;
  } | null;
  getJobLog: (params: { jobId: string; tailChars?: number }) => Promise<{
    jobId: string;
    found: boolean;
    log?: string;
  }>;
  execCommand: (params: {
    sessionKey: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
    background?: boolean;
    security?: "deny" | "allowlist" | "full";
    ask?: "off" | "on-miss" | "always";
  }) => Promise<{
    id: string;
    command: string;
    cwd: string;
    status:
      | "running"
      | "completed"
      | "failed"
      | "canceled"
      | "timed_out"
      | "approval-pending"
      | "denied";
    startedAt: string;
    endedAt?: string;
    outputTail: string;
    failureCode?:
      | "none"
      | "approval_denied"
      | "allowlist_miss"
      | "syntax_error"
      | "command_not_found"
      | "process_error"
      | "timeout_overall"
      | "timeout_no_output"
      | "signal"
      | "non_zero_exit";
    exitCode?: number | null;
    approvalId?: string;
  }>;
  processCommand: (params: {
    sessionKey: string;
    action: "list" | "poll" | "kill" | "log" | "remove";
    sessionId?: string;
    offset?: number;
    limit?: number;
  }) => Promise<{
    ok: boolean;
    action: "list" | "poll" | "kill" | "log" | "remove";
    output?: string;
    message?: string;
    sessions?: Array<{
      id: string;
      command: string;
      cwd: string;
      status: string;
      startedAt: string;
      endedAt?: string;
      outputTail: string;
      failureCode?: string;
    }>;
    session?: {
      id: string;
      command: string;
      cwd: string;
      status: string;
      startedAt: string;
      endedAt?: string;
      outputTail: string;
      failureCode?: string;
    };
  }>;
  mcpList: (params: {
    sessionKey: string;
    server?: string;
    schema?: boolean;
    timeoutMs?: number;
  }) => Promise<McpListResult>;
  mcpCall: (params: {
    sessionKey: string;
    target: string;
    argumentsJson?: string;
    stdioCommand?: string;
    timeoutMs?: number;
  }) => Promise<McpCallResult>;
  edgeList: (params?: {
    clientId?: string;
    capability?: string;
  }) => EdgeCapabilitySummary[];
  edgeCall: (params: {
    capability: string;
    input: unknown;
    clientId?: string;
    timeoutMs?: number;
  }) => Promise<EdgeCallResult>;
  youboraMetricsGet: (params: {
    fromDate: string;
    toDate?: string;
    metrics?: string;
    type?: string;
    granularity?: string;
    filters?: unknown;
    clientId?: string;
    timeoutMs?: number;
  }) => Promise<EdgeCallResult>;
  youboraRawdataGet: (params: {
    fromDate: string;
    toDate?: string;
    type?: string;
    filters?: unknown;
    clientId?: string;
    timeoutMs?: number;
  }) => Promise<EdgeCallResult>;
  youboraEventsGet: (params: {
    fromDate: string;
    toDate?: string;
    type?: string;
    filters?: unknown;
    clientId?: string;
    timeoutMs?: number;
  }) => Promise<EdgeCallResult>;
  memorySearch: (params: {
    query: string;
    maxResults?: number;
  }) => Promise<
    Array<{
      path: string;
      startLine: number;
      endLine: number;
      snippet: string;
      score: number;
    }>
  >;
  memoryGet: (params: {
    path: string;
    from?: number;
    lines?: number;
  }) => Promise<{
    path: string;
    text: string;
    startLine: number;
    endLine: number;
  }>;
  memoryWrite: (params: {
    content: string;
    target?: "daily" | "long_term";
  }) => Promise<{ path: string }>;
  workspaceSearch: (params: {
    query: string;
    maxResults?: number;
  }) => Promise<
    Array<{
      path: string;
      line: number;
      snippet: string;
    }>
  >;
  workspaceRead: (params: {
    path: string;
    from?: number;
    lines?: number;
  }) => Promise<{
    path: string;
    text: string;
    startLine: number;
    endLine: number;
  }>;
  webSearch: (params: {
    sessionKey: string;
    query: string;
    maxResults?: number;
    recencyDays?: number;
    domainsAllow?: string[];
    domainsBlock?: string[];
    signal?: AbortSignal;
  }) => Promise<WebSearchResult>;
  webFetch: (params: {
    sessionKey: string;
    url: string;
    maxChars?: number;
    signal?: AbortSignal;
  }) => Promise<WebFetchResult>;
  webResearch: (params: {
    sessionKey: string;
    query: string;
    maxResults?: number;
    fetchTop?: number;
    fetchMaxChars?: number;
    recencyDays?: number;
    domainsAllow?: string[];
    domainsBlock?: string[];
    signal?: AbortSignal;
  }) => Promise<WebResearchResult>;
  browserCommand: (params: {
    sessionKey: string;
    action: BrowserCommandAction;
    targetId?: string;
    url?: string;
    selector?: string;
    text?: string;
    key?: string;
    timeoutMs?: number;
  }) => Promise<BrowserCommandResult>;
  browserRuntimeTelemetry: () => BrowserRuntimeTelemetry;
  imageGenerate?: (params: {
    sessionKey: string;
    prompt: string;
    size?: "1024x1024" | "1536x1024" | "1024x1536";
  }) => Promise<EngineOutputArtifact>;
  videoGenerateImage?: (params: {
    sessionKey: string;
    prompt: string;
    provider?: string;
    size?: "1024x1024" | "1536x1024" | "1024x1536";
  }) => Promise<{
    artifact: EngineOutputArtifact;
    record: {
      id: string;
      sessionKey: string;
      kind: "image" | "video";
      provider: string;
      prompt: string;
      fileName: string;
      filePath: string;
      metadataPath: string;
      mimeType: string;
      bytes: number;
      createdAt: string;
    };
  }>;
  playbackAnalyze?: (params: {
    sessionKey: string;
    player: PlaybackEngine;
    source?: string;
    streamUrl?: string;
    logText?: string;
    events?: PlaybackEvent[];
  }) => Promise<PlaybackAnalysisReport>;
  planCreate: (params: {
    sessionKey: string;
    title: string;
    steps: string[];
  }) => Promise<{
    id: string;
    sessionKey: string;
    title: string;
    status: "active" | "completed" | "blocked" | "failed" | "canceled";
    createdAt: string;
    updatedAt: string;
    steps: Array<{
      id: string;
      title: string;
      status: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
      notes?: string;
      updatedAt: string;
    }>;
  }>;
  planGenerate: (params: {
    sessionKey: string;
    objective: string;
    maxSteps?: number;
  }) => Promise<{
    id: string;
    sessionKey: string;
    title: string;
    status: "active" | "completed" | "blocked" | "failed" | "canceled";
    createdAt: string;
    updatedAt: string;
    steps: Array<{
      id: string;
      title: string;
      status: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
      notes?: string;
      updatedAt: string;
    }>;
  }>;
  planList: (params: {
    sessionKey?: string;
    status?: "active" | "completed" | "blocked" | "failed" | "canceled";
    limit?: number;
  }) => Array<{
    id: string;
    sessionKey: string;
    title: string;
    status: "active" | "completed" | "blocked" | "failed" | "canceled";
    createdAt: string;
    updatedAt: string;
    steps: Array<{
      id: string;
      title: string;
      status: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
      notes?: string;
      updatedAt: string;
    }>;
  }>;
  planGet: (params: { planId: string }) => {
    id: string;
    sessionKey: string;
    title: string;
    status: "active" | "completed" | "blocked" | "failed" | "canceled";
    createdAt: string;
    updatedAt: string;
    steps: Array<{
      id: string;
      title: string;
      status: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
      notes?: string;
      updatedAt: string;
    }>;
  } | null;
  planUpdateStep: (params: {
    planId: string;
    stepIndex: number;
    status: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
    notes?: string;
  }) => Promise<{
    id: string;
    sessionKey: string;
    title: string;
    status: "active" | "completed" | "blocked" | "failed" | "canceled";
    createdAt: string;
    updatedAt: string;
    steps: Array<{
      id: string;
      title: string;
      status: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
      notes?: string;
      updatedAt: string;
    }>;
  } | null>;
  planNextAction: (params: { planId: string }) => {
    stepIndex: number;
    step: {
      id: string;
      title: string;
      status: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
      notes?: string;
      updatedAt: string;
    };
  } | null;
  planExecuteNext: (params: {
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
  }) => Promise<{
    ok: boolean;
    reason?: string;
    message?: string;
    stepIndex?: number;
    action?: "probe" | "capture" | "transcode" | "hls" | "exec" | "wait_execution" | "cancel_execution";
    plan?: {
      id: string;
      sessionKey: string;
      title: string;
      status: "active" | "completed" | "blocked" | "failed" | "canceled";
      createdAt: string;
      updatedAt: string;
      steps: Array<{
        id: string;
        title: string;
        status: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "canceled";
        notes?: string;
        updatedAt: string;
      }>;
    };
    execution?: {
      kind: "job" | "exec";
      refId: string;
      status: string;
      startedAt: string;
      command?: string;
    };
  }>;
  planReconcile: (params: { planId?: string; limit?: number }) => Promise<{
    scannedPlans: number;
    updatedPlans: number;
    updatedSteps: number;
  }>;
};

export type EngineTurnInput = {
  sessionKey: string;
  message: string;
  attachments?: EngineInboundAttachment[];
  requestId?: string;
  contextMessages?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    createdAt: string;
  }>;
  tooling: EngineTooling;
};

export type EngineInboundAttachment = {
  kind: "image" | "audio";
  dataBase64: string;
  mimeType?: string;
  fileName?: string;
};

export type EngineTurnOutput = {
  reply: string;
  artifacts?: EngineOutputArtifact[];
};

export type EngineOutputArtifact = {
  kind: "image";
  dataBase64: string;
  mimeType: string;
  fileName: string;
};

export type EngineRuntimeTelemetry = {
  timeouts: number;
  toolCallsByName: Record<string, number>;
  blockedCallsByTool: Record<string, number>;
};

export interface AgentEngine {
  runTurn(input: EngineTurnInput): Promise<EngineTurnOutput>;
  getRuntimeTelemetrySnapshot?: () => EngineRuntimeTelemetry;
}
