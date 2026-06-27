import type {
  HlsWatchEvent,
  PlaybackEngine,
  PlaybackEvent,
  PlaybackReport,
} from "@gugaio/vhs";

export type PlaybackAnalysisReport = PlaybackReport;
export type { PlaybackEngine, PlaybackEvent };

/** The watch core is VHS; Kael associates a watch with its agent session. */
export type StreamWatchParams = {
  sessionKey: string;
  url: string;
  pollIntervalMs?: number;
  maxPollCount?: number;
  timeoutMs?: number;
  maxEvents?: number;
};

export type StreamWatchEvent = HlsWatchEvent;

export type StreamWatchStatus = {
  id: string;
  sessionKey: string;
  url: string;
  startedAt: string;
  lastPollAt: string | null;
  pollCount: number;
  errorCount: number;
  events: StreamWatchEvent[];
  running: boolean;
};

export type GeneratedMediaKind = "image" | "video";

export type VideoGenerationRequest = {
  sessionKey: string;
  prompt: string;
  provider?: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  durationSeconds?: number;
};

export type StoredArtifactRecord = {
  id: string;
  sessionKey: string;
  kind: GeneratedMediaKind;
  provider: string;
  prompt: string;
  fileName: string;
  filePath: string;
  metadataPath: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
};
