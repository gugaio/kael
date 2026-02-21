import type { VideoJob } from "../types.js";
import type { WebFetchResult, WebSearchResult } from "../research/types.js";

export type EngineTooling = {
  startTranscode: (params: {
    sessionKey: string;
    inputPath: string;
    outputPath: string;
    args?: string[];
  }) => Promise<VideoJob>;
  startConvertHls: (params: {
    sessionKey: string;
    inputPath: string;
    outputPlaylistPath: string;
    segmentTime?: number;
  }) => Promise<VideoJob>;
  startCaptureStream: (params: {
    sessionKey: string;
    streamUrl: string;
    outputPath: string;
    durationSeconds?: number;
  }) => Promise<VideoJob>;
  startProbeMedia: (params: {
    sessionKey: string;
    inputPath: string;
  }) => Promise<VideoJob>;
  listJobs: () => {
    id: string;
    status: string;
    type: string;
    output?: string;
  }[];
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
    exitCode?: number | null;
    approvalId?: string;
  }>;
  processCommand: (params: {
    sessionKey: string;
    action: "list" | "poll" | "kill";
    sessionId?: string;
  }) => Promise<{
    ok: boolean;
    action: "list" | "poll" | "kill";
    message?: string;
    sessions?: Array<{
      id: string;
      command: string;
      cwd: string;
      status: string;
      startedAt: string;
      endedAt?: string;
      outputTail: string;
    }>;
    session?: {
      id: string;
      command: string;
      cwd: string;
      status: string;
      startedAt: string;
      endedAt?: string;
      outputTail: string;
    };
  }>;
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
  webSearch: (params: {
    sessionKey: string;
    query: string;
    maxResults?: number;
    recencyDays?: number;
    domainsAllow?: string[];
    domainsBlock?: string[];
  }) => Promise<WebSearchResult>;
  webFetch: (params: {
    sessionKey: string;
    url: string;
    maxChars?: number;
  }) => Promise<WebFetchResult>;
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
    };
  }) => Promise<{
    ok: boolean;
    reason?: string;
    message?: string;
    stepIndex?: number;
    action?: "probe" | "capture" | "transcode" | "hls" | "exec";
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
  contextMessages?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    createdAt: string;
  }>;
  tooling: EngineTooling;
};

export type EngineTurnOutput = {
  reply: string;
};

export interface AgentEngine {
  runTurn(input: EngineTurnInput): Promise<EngineTurnOutput>;
}
