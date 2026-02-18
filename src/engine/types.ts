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
};

export type EngineTurnInput = {
  sessionKey: string;
  message: string;
  contextMessages?: Array<{
    role: "user" | "assistant";
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
