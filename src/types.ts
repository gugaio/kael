export type MessageRole = "user" | "assistant" | "system";

export type SessionMessage = {
  id: string;
  sessionKey: string;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type SessionEntry = {
  sessionKey: string;
  sessionId: string;
  transcriptPath: string;
  createdAt: string;
  updatedAt: string;
};

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type TranscodeJob = {
  id: string;
  type: "transcode";
  sessionKey: string;
  inputPath: string;
  outputPath: string;
  args: string[];
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  error?: string;
  logPath: string;
};
