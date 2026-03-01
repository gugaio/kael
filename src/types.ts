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
  userAssistantCount?: number;
  lastCompactionUserAssistantCount?: number;
  lastCompactionAt?: string;
};

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type VideoJobType = "transcode" | "convert_hls" | "capture_stream" | "probe_media";

export type VideoJob = {
  id: string;
  type: VideoJobType;
  sessionKey: string;
  command: "ffmpeg" | "ffprobe";
  input: string;
  output?: string;
  args: string[];
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  error?: string;
  logPath: string;
};
