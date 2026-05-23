export type PlaybackEngine = "generic" | "avplayer" | "exoplayer" | "hlsjs" | "shaka";

export type PlaybackEventCategory =
  | "lifecycle"
  | "buffer"
  | "network"
  | "abr"
  | "drm"
  | "quality"
  | "error"
  | "user";

export type PlaybackIssueSeverity = "info" | "warning" | "error";

export type ManifestAuditIssue = {
  code: string;
  severity: PlaybackIssueSeverity;
  summary: string;
  evidence: string[];
};

export type HlsManifestAuditInput = {
  sessionKey: string;
  url: string;
  maxSegments?: number;
  timeoutMs?: number;
  followVariants?: boolean;
  maxVariants?: number;
};

export type HlsManifestDiffInput = {
  sessionKey: string;
  leftUrl: string;
  rightUrl: string;
  maxSegments?: number;
  timeoutMs?: number;
  followVariants?: boolean;
  maxVariants?: number;
};

export type HlsVariantAuditReport = {
  uri: string;
  url: string;
  finalUrl: string;
  bandwidth?: number;
  averageBandwidth?: number;
  resolution?: string;
  frameRate?: number;
  codecs?: string;
  audioGroupId?: string;
  subtitlesGroupId?: string;
  playlistType: "master" | "media" | "unknown";
  summary: string;
  ok: boolean;
  stats: {
    segments: number;
    targetDuration?: number;
    maxSegmentDuration?: number;
    minSegmentDuration?: number;
    averageSegmentDuration?: number;
  };
  issues: ManifestAuditIssue[];
};

export type HlsManifestAuditReport = {
  ok: boolean;
  url: string;
  finalUrl: string;
  playlistType: "master" | "media" | "unknown";
  summary: string;
  stats: {
    variants: number;
    renditions: number;
    segments: number;
    variantsAudited: number;
    variantsWithErrors: number;
    targetDuration?: number;
    maxSegmentDuration?: number;
    minSegmentDuration?: number;
    averageSegmentDuration?: number;
  };
  issues: ManifestAuditIssue[];
  variantAudits: HlsVariantAuditReport[];
  aggregateIssues: ManifestAuditIssue[];
  recommendations: string[];
};

export type HlsManifestDiffReport = {
  ok: boolean;
  summary: string;
  left: HlsManifestAuditReport;
  right: HlsManifestAuditReport;
  delta: {
    variants: number;
    renditions: number;
    segments: number;
    variantsAudited: number;
    variantsWithErrors: number;
    targetDuration?: number;
    minSegmentDuration?: number;
    maxSegmentDuration?: number;
    averageSegmentDuration?: number;
  };
  playlistTypeChanged: boolean;
  issueDiff: {
    added: ManifestAuditIssue[];
    removed: ManifestAuditIssue[];
    persisted: string[];
  };
  aggregateIssueDiff: {
    added: ManifestAuditIssue[];
    removed: ManifestAuditIssue[];
    persisted: string[];
  };
  variantDiff: {
    added: HlsVariantDiffEntry[];
    removed: HlsVariantDiffEntry[];
    changed: HlsVariantDiffEntry[];
    regressed: HlsVariantDiffEntry[];
    improved: HlsVariantDiffEntry[];
    unchanged: HlsVariantDiffEntry[];
  };
  recommendations: string[];
};

export type HlsVariantDiffEntry = {
  matchKey: string;
  status: "added" | "removed" | "changed" | "regressed" | "improved" | "unchanged";
  regressionSeverity: "none" | "low" | "medium" | "high";
  regressionScore: number;
  left?: HlsVariantAuditReport;
  right?: HlsVariantAuditReport;
  delta: {
    targetDuration?: number;
    minSegmentDuration?: number;
    maxSegmentDuration?: number;
    averageSegmentDuration?: number;
    segments?: number;
  };
  issueDiff: {
    added: ManifestAuditIssue[];
    removed: ManifestAuditIssue[];
    persisted: string[];
  };
  changedFields: string[];
  summary: string;
};

export type PlaybackEvent = {
  atMs: number;
  name: string;
  category: PlaybackEventCategory;
  detail?: string;
  fatal?: boolean;
  data?: Record<string, unknown>;
};

export type PlaybackSessionInput = {
  sessionKey: string;
  player: PlaybackEngine;
  source?: string;
  streamUrl?: string;
  logText?: string;
  events?: PlaybackEvent[];
};

export type PlaybackIssue = {
  code: string;
  severity: PlaybackIssueSeverity;
  summary: string;
  evidence: string[];
};

export type PlaybackAnalysisReport = {
  ok: boolean;
  player: PlaybackEngine;
  source?: string;
  streamUrl?: string;
  summary: string;
  metrics: {
    eventCount: number;
    errorCount: number;
    fatalErrorCount: number;
    rebufferCount: number;
    startupTimeMs?: number;
  };
  issues: PlaybackIssue[];
  recommendations: string[];
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

// ─── Stream Watch (Fase 22) ───────────────────────────────────────────────────

/**
 * Snapshot imutável de uma única leitura do manifesto HLS durante monitoramento.
 */
export type StreamSnapshot = {
  /** Timestamp Unix em ms do momento do fetch. */
  fetchedAt: number;
  /** Valor de EXT-X-MEDIA-SEQUENCE (0 se ausente). */
  mediaSequence: number;
  /** Valor de EXT-X-DISCONTINUITY-SEQUENCE (0 se ausente). */
  discontinuitySequence: number;
  /** Valor de EXT-X-TARGETDURATION (0 se ausente). */
  targetDuration: number;
  /** Segmentos capturados no manifest. */
  segments: Array<{ uri: string; duration?: number }>;
  /**
   * Índices (0-based) dentro do array `segments` onde apareceu
   * #EXT-X-DISCONTINUITY antes do segmento.
   */
  discontinuityMarkers: number[];
  /** Se o manifesto declara rendições de áudio (EXT-X-MEDIA TYPE=AUDIO). */
  hasAudioRenditions: boolean;
  /** Quantidade de rendições de áudio declaradas. */
  audioRenditionCount: number;
};

/** Evento detectado durante monitoramento de stream. */
export type StreamWatchEvent = {
  code: string;
  severity: PlaybackIssueSeverity;
  summary: string;
  evidence: string[];
  /** ISO 8601 do momento da detecção. */
  detectedAt: string;
};

/** Parâmetros para iniciar uma sessão de monitoramento. */
export type StreamWatchParams = {
  sessionKey: string;
  url: string;
  /** Intervalo entre polls em ms. Padrão: 5000. Mínimo: 1000. */
  pollIntervalMs?: number;
  /** Número máximo de polls (undefined = infinito). */
  maxPollCount?: number;
  /** Timeout de fetch por poll. Padrão: 15000. */
  timeoutMs?: number;
  /** Máximo de eventos armazenados por sessão antes de rotacionar. Padrão: 500. */
  maxEvents?: number;
};

/** Estado atual de uma sessão de monitoramento. */
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

// ─── Streamer (Fase 23) ──────────────────────────────────────────────────────

export type StreamerCloneInput = {
  sessionKey: string;
  url: string;
  /** Duração alvo em segundos. O clone inclui segmentos até cumulative >= alvo. */
  durationSeconds?: number;
  /** Offset aproximado em segundos para iniciar a janela clonada. */
  startSeconds?: number;
  /** Para master playlists: aac-highest (default), highest, lowest ou índice zero-based da variant. */
  variant?: string;
  /** Quando true, clona todas as variants da master playlist e gera uma master local. */
  allVariants?: boolean;
  /** Limite opcional de variants quando `allVariants` estiver ativo. */
  maxVariants?: number;
  timeoutMs?: number;
  /** Timeout por segmento em ms. Padrao maior que o timeout de manifesto porque chunks 4K podem ser pesados. */
  segmentTimeoutMs?: number;
  /** Quantidade de retries por segmento apos a primeira tentativa. */
  segmentRetries?: number;
  maxSegments?: number;
  originId?: string;
  onProgress?: (event: StreamerCloneProgressEvent) => void;
};

export type StreamerCloneProgressEvent =
  | {
      type: "start";
      originId: string;
      url: string;
      durationSeconds: number;
      startSeconds: number;
      allVariants: boolean;
    }
  | {
      type: "manifest_fetch";
      url: string;
    }
  | {
      type: "manifest_ready";
      url: string;
      playlistType: "master" | "media" | "unknown";
      variantCount: number;
      segmentCount: number;
    }
  | {
      type: "variant_inspect";
      variantIndex: number;
      variantCount: number;
      label: string;
      url: string;
    }
  | {
      type: "variant_ready";
      variantIndex: number;
      variantCount: number;
      label: string;
      segmentCount: number;
      targetDuration: number;
    }
  | {
      type: "segment_download_start";
      variantIndex: number;
      variantCount: number;
      segmentIndex: number;
      segmentCount: number;
      url: string;
      duration?: number;
    }
  | {
      type: "segment_download_retry";
      variantIndex: number;
      variantCount: number;
      segmentIndex: number;
      segmentCount: number;
      attempt: number;
      maxAttempts: number;
      error: string;
    }
  | {
      type: "segment_downloaded";
      variantIndex: number;
      variantCount: number;
      segmentIndex: number;
      segmentCount: number;
      localUri: string;
      bytes: number;
      cumulativeBytes: number;
      cumulativeDurationSeconds: number;
    }
  | {
      type: "complete";
      originId: string;
      segmentCount: number;
      variantCount: number;
      bytes: number;
      cumulativeDurationSeconds: number;
    };

export type StreamerClonedSegment = {
  originalIndex: number;
  sourceUri: string;
  sourceUrl: string;
  localUri: string;
  duration?: number;
  timelineStartSeconds?: number;
  timelineEndSeconds?: number;
  title?: string;
  bytes: number;
  map?: StreamerClonedMap;
};

export type StreamerClonedMap = {
  sourceUri: string;
  sourceUrl: string;
  localUri: string;
  bytes: number;
};

export type StreamerClonedVariant = {
  sourceUri: string;
  sourceUrl: string;
  finalUrl: string;
  localUri: string;
  manifestPath: string;
  targetDuration: number;
  segmentCount: number;
  cumulativeDurationSeconds: number;
  reachedTargetDuration: boolean;
  bytes: number;
  maps: StreamerClonedMap[];
  variant?: {
    uri: string;
    url: string;
    bandwidth?: number;
    averageBandwidth?: number;
    resolution?: string;
    frameRate?: number;
    codecs?: string;
    audioGroupId?: string;
    subtitlesGroupId?: string;
    closedCaptions?: string;
  };
  segments: StreamerClonedSegment[];
};

export type StreamerClonedRendition = {
  type: string;
  groupId?: string;
  name?: string;
  language?: string;
  default?: boolean;
  autoselect?: boolean;
  forced?: boolean;
  channels?: string;
  characteristics?: string;
  sourceUri: string;
  sourceUrl: string;
  finalUrl: string;
  localUri: string;
  manifestPath: string;
  targetDuration: number;
  segmentCount: number;
  cumulativeDurationSeconds: number;
  reachedTargetDuration: boolean;
  bytes: number;
  maps: StreamerClonedMap[];
  segments: StreamerClonedSegment[];
};

export type StreamerCloneResult = {
  id: string;
  schemaVersion: number;
  derivedFrom?: string;
  faults?: StreamerOriginFault[];
  sessionKey: string;
  sourceUrl: string;
  selectedUrl: string;
  finalUrl: string;
  rootDir: string;
  manifestPath: string;
  playbackPath: string;
  requestedDurationSeconds: number;
  requestedStartSeconds?: number;
  cumulativeDurationSeconds: number;
  reachedTargetDuration: boolean;
  targetDuration: number;
  segmentCount: number;
  variantCount: number;
  renditionCount: number;
  bytes: number;
  allVariants: boolean;
  selectedVariant?: {
    uri: string;
    url: string;
    bandwidth?: number;
    averageBandwidth?: number;
    resolution?: string;
    frameRate?: number;
    codecs?: string;
    audioGroupId?: string;
    subtitlesGroupId?: string;
    closedCaptions?: string;
  };
  createdAt: string;
  variants: StreamerClonedVariant[];
  renditions: StreamerClonedRendition[];
  segments: StreamerClonedSegment[];
};

export type StreamerFaultTargetKind = "variant" | "rendition";

export type StreamerFaultType = "discontinuity" | "segment-swap";

export type StreamerOriginFault = {
  type: StreamerFaultType;
  targetKind: StreamerFaultTargetKind;
  targetIndex: number;
  segmentIndex: number;
  description: string;
  createdAt: string;
  donorOriginId?: string;
  donorTargetKind?: StreamerFaultTargetKind;
  donorTargetIndex?: number;
  donorSegmentIndex?: number;
  withDiscontinuity?: boolean;
};

export type StreamerMutateInput = {
  originId: string;
  fault: StreamerFaultType;
  targetKind?: StreamerFaultTargetKind;
  targetIndex?: number;
  segmentIndex: number;
  donorOriginId?: string;
  donorTargetKind?: StreamerFaultTargetKind;
  donorTargetIndex?: number;
  donorSegmentIndex?: number;
  withDiscontinuity?: boolean;
  ffmpegProfile?: "hevc";
  newOriginId?: string;
};

export type StreamerMutateResult = {
  sourceOriginId: string;
  origin: StreamerCloneResult;
  fault: StreamerOriginFault;
};

export type StreamerProbeOptions = {
  /** Timeout de ffprobe por playlist amostrada. */
  timeoutMs?: number;
  /** Quantidade maxima de playlists de media amostradas (variants + renditions). */
  maxMediaPlaylists?: number;
};

export type StreamerMediaProbeEntry = {
  kind: "variant" | "rendition";
  index: number;
  type: "AUDIO" | "SUBTITLES" | "VIDEO";
  label: string;
  manifestPath: string;
  ok: boolean;
  streamCount: number;
  errors: string[];
};

export type StreamerOriginProbeReport = {
  originId: string;
  ok: boolean;
  sampledMediaPlaylists: number;
  totalMediaPlaylists: number;
  okCount: number;
  failedCount: number;
  entries: StreamerMediaProbeEntry[];
};

export type StreamerAnalyzeOptions = {
  /** Timeout de ffprobe por segmento amostrado. */
  timeoutMs?: number;
  /** Quantidade maxima de playlists de media consideradas (variants + renditions). */
  maxMediaPlaylists?: number;
  /** Quantidade maxima de segmentos amostrados por playlist (first/middle/last). */
  maxSegmentsPerPlaylist?: number;
  /** Analisa todos os segmentos das playlists consideradas. */
  full?: boolean;
};

export type StreamerTimelineContinuityStatus = "ok" | "gap" | "overlap" | "reset" | "unknown";

export type StreamerSegmentAnalysisEntry = {
  kind: "variant" | "rendition";
  mediaIndex: number;
  segmentIndex: number;
  type: "AUDIO" | "SUBTITLES" | "VIDEO";
  label: string;
  localPath: string;
  timelineStartSeconds?: number;
  timelineEndSeconds?: number;
  declaredDurationSeconds?: number;
  actualDurationSeconds?: number;
  durationDeltaSeconds?: number;
  streamCount: number;
  codecName?: string;
  sampleRate?: number;
  channels?: number;
  packetCount?: number;
  firstPtsTime?: number;
  lastPtsTime?: number;
  lastSampleDurationSeconds?: number;
  firstPtsUs?: number;
  lastPtsUs?: number;
  lastSampleDurationUs?: number;
  nextExpectedPtsUs?: number;
  nextActualPtsUs?: number;
  nextDeltaUs?: number;
  continuityStatus?: StreamerTimelineContinuityStatus;
  boundaryDeltaSeconds?: number;
  boundaryStatus?: "ok" | "warn" | "reset" | "unknown";
  keyframeCount?: number;
  startsWithKeyframe?: boolean;
  maxKeyframeGapSeconds?: number;
  ok: boolean;
  errors: string[];
};

export type StreamerMediaAnalysisSummary = {
  kind: "variant" | "rendition";
  mediaIndex: number;
  type: "AUDIO" | "SUBTITLES" | "VIDEO";
  label: string;
  sampledSegments: number;
  durationDeltaMaxSeconds?: number;
  durationDeltaAverageSeconds?: number;
  boundaryStatus: "ok" | "warn" | "reset" | "unknown";
  boundaryDeltaMaxSeconds?: number;
  gopStatus?: "ok" | "warn" | "unknown";
  maxKeyframeGapSeconds?: number;
  startsWithKeyframeFailures?: number;
};

export type StreamerAvAlignmentSummary = {
  status: "ok" | "warn" | "unknown";
  comparedPairs: number;
  maxDurationDeltaSeconds?: number;
  maxStartPtsDeltaSeconds?: number;
  comparedTimelineWindows?: number;
  maxTimelineDriftSeconds?: number;
  timelineDriftWindows?: StreamerAvTimelineDriftWindow[];
  notes: string[];
};

export type StreamerAvTimelineDriftWindow = {
  audioMediaIndex: number;
  videoSegmentIndex: number;
  audioSegmentIndex: number;
  timelineStartSeconds: number;
  timelineEndSeconds: number;
  videoDurationSeconds: number;
  audioDurationSeconds: number;
  startDeltaSeconds: number;
  endDeltaSeconds: number;
  durationDeltaSeconds: number;
  actualDurationDeltaSeconds?: number;
  status: "ok" | "warn";
};

export type StreamerAnalysisIssue = {
  severity: PlaybackIssueSeverity;
  code: string;
  summary: string;
  evidence: string[];
};

export type StreamerOriginAnalysisReport = {
  originId: string;
  ok: boolean;
  sampledMediaPlaylists: number;
  totalMediaPlaylists: number;
  sampledSegments: number;
  okSegments: number;
  failedSegments: number;
  media: StreamerMediaAnalysisSummary[];
  avAlignment: StreamerAvAlignmentSummary;
  issues: StreamerAnalysisIssue[];
  entries: StreamerSegmentAnalysisEntry[];
};

export type StreamerOriginSummary = {
  id: string;
  schemaVersion: number;
  derivedFrom?: string;
  faults: StreamerOriginFault[];
  createdAt: string;
  sourceUrl: string;
  selectedUrl: string;
  rootDir: string;
  playbackPath: string;
  requestedDurationSeconds: number;
  requestedStartSeconds?: number;
  cumulativeDurationSeconds: number;
  reachedTargetDuration: boolean;
  targetDuration: number;
  segmentCount: number;
  variantCount: number;
  renditionCount: number;
  bytes: number;
  allVariants: boolean;
};

export type StreamerRemoveResult = {
  id: string;
  rootDir: string;
  removed: boolean;
};

export type StreamerServeOptions = {
  host?: string;
  port?: number;
};

export type StreamerServeHandle = {
  originId: string;
  rootDir: string;
  baseUrl: string;
  playbackUrl: string;
  close(): Promise<void>;
};

export type StreamerLiveServeOptions = StreamerServeOptions & {
  /** Quantidade de segmentos expostos na janela live. Padrao: 5. */
  windowSize?: number;
  /** Sequencia inicial virtual para evitar edge cases com players que tratam zero de forma especial. */
  initialMediaSequence?: number;
};

export type StreamerLiveServeHandle = StreamerServeHandle & {
  windowSize: number;
  initialMediaSequence: number;
};
