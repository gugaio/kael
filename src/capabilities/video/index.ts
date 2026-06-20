// Kael-owned video concerns: jobs, generated artifacts and agent session adapters.
export { VideoJobCapability, VideoJobCapability as VideoCapability, VIDEO_JOB_ACTIONS } from "./jobs/job-capability.js";
export { VideoJobService } from "./jobs/job-service.js";
export { VideoJobValidationError } from "./jobs/safety.js";
export { VideoArtifactsService } from "./artifacts-service.js";
export { ProviderBackedVideoGenerationService, NoopVideoGenerationService } from "./generation-service.js";
export { HlsStreamMonitorService } from "./stream-monitor-service.js";

// Deterministic media work belongs to the standalone VHS package.
export {
  MediaInspector as VideoInspectToolService,
  PlaybackTriageService,
  StreamerService,
  renderStreamerAnalysisHtml,
  diagnoseStreamerClone,
  analyzeSnapshotTransition,
  toHlsSnapshot as toStreamSnapshot,
  deriveHlsJsIssues,
  parseHlsJsLogText,
} from "@gugaio/vhs";

export type {
  HlsManifestAuditInput,
  HlsManifestDiffInput,
  StreamWatchEvent,
  StreamWatchParams,
  StreamWatchStatus,
  StoredArtifactRecord,
  VideoGenerationRequest,
} from "./types.js";

export type {
  ManifestAuditIssue,
  ManifestAuditReport as HlsManifestAuditReport,
  ManifestDiffReport as HlsManifestDiffReport,
  ManifestSeverity as PlaybackIssueSeverity,
  ManifestVariantAudit as HlsVariantAuditReport,
  PlaybackEngine,
  PlaybackEvent,
  PlaybackInput as PlaybackSessionInput,
  PlaybackIssue,
  PlaybackReport as PlaybackAnalysisReport,
  HlsSnapshot as StreamSnapshot,
  StreamerBrowserCompatibility,
  StreamerCloneDiagnostic,
  StreamerDiagnosticIssue,
  StreamerVariantDiagnostic,
} from "@gugaio/vhs";

export type * from "@gugaio/vhs";
