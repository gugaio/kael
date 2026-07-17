import type { AgentTool } from "@mariozechner/pi-agent-core";

export type MediaInvestigationState =
  | "queued"
  | "collecting"
  | "analyzing"
  | "synthesizing"
  | "completed"
  | "failed";

export type MediaInvestigationAgentState = "queued" | "running" | "completed" | "failed";

export type MediaFinding = {
  code: string;
  severity: "info" | "warning" | "error";
  confidence: number;
  summary: string;
  evidenceIds: string[];
};

export type MediaHypothesis = {
  code: string;
  description: string;
  likelyStage?: string;
  confidence: number;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  explainedEvidenceIds: string[];
  unexplainedEvidenceIds: string[];
  predictedObservations: string[];
  causalChain: string[];
};

export type MediaSpecialistOutput = {
  summary: string;
  findings: MediaFinding[];
  hypotheses: MediaHypothesis[];
  requestedChecks: string[];
  limitations: string[];
};

export type MediaInvestigationSynthesis = {
  summary: string;
  likelyCause: string;
  confidence: number;
  perceptualImpact: string;
  causalChain: string[];
  evidenceCoverage: number;
  unresolvedEvidenceIds: string[];
  rankedHypotheses: Array<{
    code: string;
    description: string;
    confidence: number;
    explainedEvidenceIds: string[];
    contradictingEvidenceIds: string[];
  }>;
  consensus: string[];
  disagreements: string[];
  nextSteps: string[];
};

export type MediaInvestigationProblemContext = {
  approximateTime?: string;
  affectedTrack?: "audio" | "video" | "both" | "unknown";
  player?: string;
  reproducibility?: string;
  expectedBehavior?: string;
};

export type MediaContentQaEvidence = {
  id: string;
  kind: "freeze" | "black" | "silence" | "decode" | "manifest";
  summary: string;
  startSeconds?: number;
  endSeconds?: number;
  durationSeconds?: number;
  tool: string;
  parameters: Record<string, unknown>;
  playlist?: string;
  segmentIndex?: number;
  segmentUri?: string;
  mediaSequence?: number;
  discontinuitySequence?: number;
  segmentCount?: number;
  discontinuityCount?: number;
  hasDiscontinuityBefore?: boolean;
  previousTags?: string[];
};

export type MediaInvestigationActivity = {
  id: string;
  tool: string;
  reason: string;
  state: "running" | "completed" | "failed" | "blocked";
  parameters: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  evidenceIds: string[];
  summary?: string;
  error?: string;
};

export type MediaAvOffsetSample = {
  segmentIndex: number;
  videoFirstPtsSeconds: number;
  audioFirstPtsSeconds: number;
  offsetSeconds: number;
};

export type MediaAvOffsetSeries = {
  id: string;
  videoLabel: string;
  audioLabel: string;
  pattern: "aligned" | "constant_offset" | "drift" | "discontinuity" | "variable" | "insufficient";
  sampleCount: number;
  medianOffsetSeconds: number;
  offsetSpreadSeconds: number;
  firstToLastChangeSeconds?: number;
  maxAdjacentChangeSeconds?: number;
  samples: MediaAvOffsetSample[];
};

export type MediaAgentPromptSnapshot = {
  path: string;
  version: string;
  hash: string;
  content: string;
};

export type MediaInvestigationAgentRun = {
  id: string;
  label: string;
  role: "specialist" | "synthesizer";
  state: MediaInvestigationAgentState;
  prompt: MediaAgentPromptSnapshot;
  model?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  output?: MediaSpecialistOutput;
  synthesis?: MediaInvestigationSynthesis;
  rawOutput?: string;
  error?: string;
};

export type MediaEvidenceBundle = {
  id: string;
  originId: string;
  capturedAt: string;
  sourceUrl: string;
  protocol: string;
  summary: {
    segmentCount: number;
    variantCount: number;
    renditionCount: number;
    durationSeconds: number;
    bytes: number;
  };
  probe: unknown;
  analysis: unknown;
  derived: {
    avOffsetSeries: MediaAvOffsetSeries[];
    contentQa: MediaContentQaEvidence[];
  };
  evidenceIndex: Array<{
    id: string;
    kind: "issue" | "segment" | "media" | "probe" | "derived";
    summary: string;
  }>;
};

export type MediaInvestigationRecord = {
  id: string;
  originId: string;
  problemStatement: string;
  problemContext?: MediaInvestigationProblemContext;
  sourceInvestigationId?: string;
  state: MediaInvestigationState;
  fullAnalysis: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  evidence?: MediaEvidenceBundle;
  agents: MediaInvestigationAgentRun[];
  activities: MediaInvestigationActivity[];
  synthesis?: MediaInvestigationSynthesis;
  error?: string;
};

export type MediaInvestigationAgentInput = {
  investigationId: string;
  problemStatement: string;
  problemContext?: MediaInvestigationProblemContext;
  evidence: MediaEvidenceBundle;
  specialistReports?: Array<{
    id: string;
    label: string;
    output: MediaSpecialistOutput;
  }>;
};

export interface MediaInvestigationAgentRunner {
  readonly available: boolean;
  readonly model?: string;
  run(params: {
    prompt: MediaAgentPromptSnapshot;
    input: MediaInvestigationAgentInput;
    tools?: AgentTool[];
  }): Promise<{ raw: string; parsed: unknown }>;
}
