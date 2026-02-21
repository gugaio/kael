import type { VideoJob } from "../types.js";

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
