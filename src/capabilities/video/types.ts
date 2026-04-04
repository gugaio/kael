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
