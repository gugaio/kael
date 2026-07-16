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
  profile?: "manifest" | "chunks" | "full";
  mode?: "auto" | "vod" | "live";
  pollIntervalMs?: number;
  maxPollCount?: number;
  timeoutMs?: number;
  maxEvents?: number;
  maxDurationMs?: number;
  retentionHours?: number;
  variantSelector?: "aac-highest" | "aac-lowest" | "highest" | "lowest" | string;
  allVariants?: boolean;
};

export type StreamWatchEvent = HlsWatchEvent;

export type StreamWatchChunkStatus = {
  id: string;
  phase: "queued" | "downloading" | "downloaded" | "analyzing" | "analyzed" | "failed";
  variantIndex: number;
  variantCount: number;
  segmentIndex: number;
  segmentCount: number;
  originalSegmentIndex?: number;
  url?: string;
  localUri?: string;
  startedAt?: string;
  downloadedAt?: string;
  analyzedAt?: string;
  bytes?: number;
  durationSeconds?: number;
  streamType?: "video" | "audio" | "subtitle" | "data" | "unknown";
  codecName?: string;
  streamSelector?: string;
  actualDurationSeconds?: number;
  durationDeltaSeconds?: number;
  continuityStatus?: string;
  keyframeCount?: number;
  startsWithKeyframe?: boolean;
  firstPtsTime?: number;
  lastPtsTime?: number;
  firstDtsTime?: number;
  lastDtsTime?: number;
  avStartPtsDeltaSeconds?: number;
  avEndPtsDeltaSeconds?: number;
  avBoundaryDeltaSeconds?: number;
  avBoundaryStatus?: "ok" | "gap" | "overlap" | "reset" | "unknown";
  streams?: StreamWatchChunkStreamStatus[];
  errors: string[];
};

export type StreamWatchChunkStreamStatus = {
  streamSelector: string;
  streamType?: "video" | "audio" | "subtitle" | "data" | "unknown";
  codecName?: string;
  actualDurationSeconds?: number;
  durationDeltaSeconds?: number;
  firstPtsTime?: number;
  lastPtsTime?: number;
  firstDtsTime?: number;
  lastDtsTime?: number;
  lastSampleDurationSeconds?: number;
  previousPtsDeltaSeconds?: number;
  previousBoundaryStatus?: "ok" | "gap" | "overlap" | "reset" | "unknown";
  sampleCount?: number;
  keyframeCount?: number;
  startsWithKeyframe?: boolean;
  maxKeyframeGapSeconds?: number;
  errors: string[];
};

export type StreamWatchManifestReport = {
  id: string;
  checkedAt: string;
  url: string;
  finalUrl: string;
  playlistType: "master" | "media" | "unknown";
  targetDuration?: number;
  maxSegmentDuration?: number;
  targetDurationStatus: "ok" | "critical" | "unknown";
  mediaSequence?: number;
  previousMediaSequence?: number;
  mediaSequenceDelta?: number;
  mediaSequenceExpectedDelta?: number;
  mediaSequenceExcessDelta?: number;
  mediaSequenceStatus: "ok" | "gap" | "stale" | "unknown";
  discontinuityCount: number;
  network?: {
    httpStatus: number;
    statusText: string;
    headerTimeMs?: number;
    ttfbMs: number;
    downloadTimeMs: number;
    bodyTimeMs?: number;
    bytes: number;
    status: "excellent" | "held" | "warning" | "critical";
  };
  issues: StreamWatchEvent[];
};

export type StreamWatchAbrVariantReport = {
  label: string;
  url: string;
  bandwidth?: number;
  resolution?: string;
  segmentSequence: number;
  localUri?: string;
  bytes?: number;
  actualDurationSeconds?: number;
  firstPtsTime?: number;
  lastPtsTime?: number;
  firstDtsTime?: number;
  lastDtsTime?: number;
  keyframeCount?: number;
  startsWithKeyframe?: boolean;
  errors: string[];
};

export type StreamWatchAbrAlignmentReport = {
  id: string;
  checkedAt: string;
  segmentSequence: number;
  profilesAnalyzed: number;
  status: "ok" | "warning" | "critical";
  ptsStartDeltaSeconds?: number;
  durationDeltaSeconds?: number;
  variants: StreamWatchAbrVariantReport[];
  issues: StreamWatchEvent[];
};

export type StreamWatchStatus = {
  id: string;
  sessionKey: string;
  url: string;
  profile: "manifest" | "chunks" | "full";
  mode: "auto" | "vod" | "live";
  inputType: "unknown" | "vod" | "live";
  state: "running" | "completed" | "failed" | "stopped";
  startedAt: string;
  completedAt?: string;
  expiresAt?: string;
  lastPollAt: string | null;
  pollCount: number;
  errorCount: number;
  downloadedSegmentCount: number;
  analyzedSegmentCount: number;
  totalSegmentCount?: number;
  currentChunk?: StreamWatchChunkStatus;
  recentChunks: StreamWatchChunkStatus[];
  manifestReports: StreamWatchManifestReport[];
  abrReports: StreamWatchAbrAlignmentReport[];
  originId?: string;
  report?: {
    jsonPath?: string;
    htmlPath?: string;
  };
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
