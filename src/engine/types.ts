import type { TranscodeJob } from "../types.js";

export type EngineTooling = {
  startTranscode: (params: {
    sessionKey: string;
    inputPath: string;
    outputPath: string;
    args?: string[];
  }) => Promise<TranscodeJob>;
  listJobs: () => {
    id: string;
    status: string;
    outputPath: string;
  }[];
};

export type EngineTurnInput = {
  sessionKey: string;
  message: string;
  tooling: EngineTooling;
};

export type EngineTurnOutput = {
  reply: string;
};

export interface AgentEngine {
  runTurn(input: EngineTurnInput): Promise<EngineTurnOutput>;
}
