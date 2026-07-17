import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { StreamerRuntime } from "../agents/context.js";
import { ensureDir, writeJsonFile } from "../infra/fs.js";
import { kaelLogger } from "../infra/logger.js";
import { createMediaInvestigationTools } from "./content-tools.js";
import { deriveAvOffsetSeries } from "./derived-evidence.js";
import type {
  MediaAgentPromptSnapshot,
  MediaEvidenceBundle,
  MediaFinding,
  MediaHypothesis,
  MediaInvestigationAgentRun,
  MediaInvestigationAgentRunner,
  MediaInvestigationRecord,
  MediaInvestigationSynthesis,
  MediaSpecialistOutput,
} from "./types.js";

type SpecialistDefinition = {
  id: string;
  label: string;
  fileName: string;
  role: "specialist" | "synthesizer";
};

const SPECIALISTS: SpecialistDefinition[] = [
  { id: "timeline-container", label: "Timeline & Container", fileName: "timeline-container.md", role: "specialist" },
  { id: "audio-video", label: "Audio & Video", fileName: "audio-video.md", role: "specialist" },
  { id: "manifest-delivery", label: "Manifest & Delivery", fileName: "manifest-delivery.md", role: "specialist" },
];
const SYNTHESIZER: SpecialistDefinition = {
  id: "synthesizer",
  label: "Lead Investigator",
  fileName: "synthesizer.md",
  role: "synthesizer",
};

export class MediaInvestigationService {
  private readonly records = new Map<string, MediaInvestigationRecord>();
  private readonly persistQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly streamer: Pick<StreamerRuntime, "inspectOrigin" | "probeOrigin" | "analyzeOrigin">,
    private readonly runner: MediaInvestigationAgentRunner,
    private readonly rootDir: string,
    private readonly promptDir: string,
  ) {}

  get agentsAvailable(): boolean {
    return this.runner.available;
  }

  async init(): Promise<void> {
    await ensureDir(this.rootDir);
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(this.rootDir, entry.name), "utf-8")) as MediaInvestigationRecord;
        parsed.problemStatement ||= "Realize uma triagem geral da midia e investigue anomalias tecnicas ou perceptuais.";
        parsed.activities ??= [];
        if (parsed.evidence?.derived) parsed.evidence.derived.contentQa ??= [];
        if (!["completed", "failed"].includes(parsed.state)) {
          parsed.state = "failed";
          parsed.error = "Kael restarted before the investigation completed";
          parsed.completedAt = new Date().toISOString();
          parsed.updatedAt = parsed.completedAt;
          for (const agent of parsed.agents) {
            if (agent.state === "running") {
              agent.state = "failed";
              agent.error = "Agent run interrupted by Kael restart";
              agent.completedAt = parsed.completedAt;
            }
          }
          await writeJsonFile(path.join(this.rootDir, entry.name), parsed);
        }
        this.records.set(parsed.id, parsed);
      } catch {
        // A corrupt record remains on disk for manual inspection and is ignored by the runtime.
      }
    }
  }

  list(limit = 100): MediaInvestigationRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, Math.min(500, Math.floor(limit))));
  }

  get(id: string): MediaInvestigationRecord | null {
    return this.records.get(id) ?? null;
  }

  async start(params: {
    originId: string;
    problemStatement?: string;
    problemContext?: MediaInvestigationRecord["problemContext"];
    fullAnalysis?: boolean;
    sourceInvestigationId?: string;
  }): Promise<MediaInvestigationRecord> {
    if (!this.runner.available) {
      throw new Error("media investigation agents are unavailable; configure KAEL_PI_API_KEY");
    }
    const definitions = [...SPECIALISTS, SYNTHESIZER];
    const prompts = await Promise.all(definitions.map((definition) => this.loadPrompt(definition)));
    const now = new Date().toISOString();
    const id = randomUUID();
    const record: MediaInvestigationRecord = {
      id,
      originId: params.originId,
      problemStatement: params.problemStatement?.trim() || "Realize uma triagem geral da midia e investigue anomalias tecnicas ou perceptuais.",
      ...(params.problemContext ? { problemContext: params.problemContext } : {}),
      ...(params.sourceInvestigationId ? { sourceInvestigationId: params.sourceInvestigationId } : {}),
      state: "queued",
      fullAnalysis: params.fullAnalysis ?? true,
      createdAt: now,
      updatedAt: now,
      agents: definitions.map((definition, index) => ({
        id: definition.id,
        label: definition.label,
        role: definition.role,
        state: "queued",
        prompt: prompts[index],
        model: this.runner.model,
      })),
      activities: [],
    };
    this.records.set(id, record);
    await this.persist(record);
    void this.execute(record).catch((error) => {
      kaelLogger.error("media.investigation.unhandled", {
        investigationId: record.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return record;
  }

  async rerun(id: string): Promise<MediaInvestigationRecord> {
    const source = this.get(id);
    if (!source) throw new Error(`media investigation ${id} not found`);
    return this.start({
      originId: source.originId,
      problemStatement: source.problemStatement,
      ...(source.problemContext ? { problemContext: source.problemContext } : {}),
      fullAnalysis: source.fullAnalysis,
      sourceInvestigationId: source.id,
    });
  }

  private async execute(record: MediaInvestigationRecord): Promise<void> {
    try {
      await this.transition(record, "collecting");
      const evidence = await this.collectEvidence(record);
      record.evidence = evidence;
      await this.transition(record, "analyzing");

      const specialists = record.agents.filter((agent) => agent.role === "specialist");
      await Promise.all(specialists.map((agent) => this.runSpecialist(record, agent, evidence)));
      const completed = specialists.filter((agent) => agent.state === "completed" && agent.output);
      if (completed.length === 0) {
        throw new Error("all media investigation specialists failed");
      }

      await this.transition(record, "synthesizing");
      const synthesizer = record.agents.find((agent) => agent.role === "synthesizer");
      if (!synthesizer) throw new Error("media investigation synthesizer is missing");
      await this.runSynthesizer(record, synthesizer, evidence, completed);
      if (!synthesizer.synthesis) throw new Error("media investigation synthesis failed");

      record.synthesis = synthesizer.synthesis;
      record.completedAt = new Date().toISOString();
      await this.transition(record, "completed");
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      record.completedAt = new Date().toISOString();
      await this.transition(record, "failed");
    }
  }

  private async collectEvidence(record: MediaInvestigationRecord): Promise<MediaEvidenceBundle> {
    const origin = await this.streamer.inspectOrigin(record.originId);
    const [probe, analysis] = await Promise.all([
      this.streamer.probeOrigin(record.originId, { maxMediaPlaylists: 12 }),
      this.streamer.analyzeOrigin(record.originId, {
        full: record.fullAnalysis,
        maxMediaPlaylists: 12,
        ...(record.fullAnalysis ? {} : { maxSegmentsPerPlaylist: 5 }),
      }),
    ]);
    const avOffsetSeries = deriveAvOffsetSeries(analysis);
    const evidenceIndex: MediaEvidenceBundle["evidenceIndex"] = [
      ...probe.entries.map((entry, index) => ({
        id: `probe.entry.${index}`,
        kind: "probe" as const,
        summary: `${entry.label}: ${entry.ok ? "ok" : "failed"}; ${entry.errors.join("; ") || "no errors"}`,
      })),
      ...analysis.issues.map((issue, index) => ({
        id: `analysis.issue.${index}`,
        kind: "issue" as const,
        summary: `${issue.code}: ${issue.summary}${issue.evidence.length > 0 ? `; ${issue.evidence.join("; ")}` : ""}`,
      })),
      ...analysis.media.map((media, index) => ({
        id: `analysis.media.${index}`,
        kind: "media" as const,
        summary: `${media.label}: boundary=${media.boundaryStatus}; gop=${media.gopStatus ?? "unknown"}`,
      })),
      ...analysis.entries.map((entry, index) => ({
        id: `analysis.segment.${index}`,
        kind: "segment" as const,
        summary: [
          entry.label,
          `segment=${entry.originalSegmentIndex ?? entry.segmentIndex}`,
          `stream=${entry.streamSelector ?? entry.type}`,
          `ok=${entry.ok}`,
          ...(typeof entry.firstPtsTime === "number" ? [`firstPts=${entry.firstPtsTime.toFixed(6)}s`] : []),
          ...(typeof entry.lastPtsTime === "number" ? [`lastPts=${entry.lastPtsTime.toFixed(6)}s`] : []),
          ...(typeof entry.durationDeltaSeconds === "number" ? [`durationDelta=${signedSeconds(entry.durationDeltaSeconds)}`] : []),
          ...(typeof entry.boundaryDeltaSeconds === "number" ? [`boundaryDelta=${signedSeconds(entry.boundaryDeltaSeconds)}`] : []),
          ...(entry.continuityStatus ? [`continuity=${entry.continuityStatus}`] : []),
        ].join("; "),
      })),
      ...avOffsetSeries.map((series) => ({
        id: series.id,
        kind: "derived" as const,
        summary: [
          `A/V PTS pattern=${series.pattern}`,
          `audio=${series.audioLabel}`,
          `video=${series.videoLabel}`,
          `samples=${series.sampleCount}`,
          `medianOffset=${signedSeconds(series.medianOffsetSeconds)}`,
          `spread=${series.offsetSpreadSeconds.toFixed(3)}s`,
          ...(series.firstToLastChangeSeconds === undefined
            ? []
            : [`firstToLast=${signedSeconds(series.firstToLastChangeSeconds)}`]),
        ].join("; "),
      })),
    ];
    return {
      id: randomUUID(),
      originId: origin.id,
      capturedAt: new Date().toISOString(),
      sourceUrl: origin.sourceUrl,
      protocol: origin.protocol ?? "hls",
      summary: {
        segmentCount: origin.segmentCount,
        variantCount: origin.variantCount,
        renditionCount: origin.renditionCount,
        durationSeconds: origin.cumulativeDurationSeconds,
        bytes: origin.bytes,
      },
      probe,
      analysis,
      derived: { avOffsetSeries, contentQa: [] },
      evidenceIndex,
    };
  }

  private async runSpecialist(
    record: MediaInvestigationRecord,
    agent: MediaInvestigationAgentRun,
    evidence: MediaEvidenceBundle,
  ): Promise<void> {
    await this.startAgent(record, agent);
    try {
      const result = await this.runner.run({
        prompt: agent.prompt,
        input: {
          investigationId: record.id,
          problemStatement: record.problemStatement,
          ...(record.problemContext ? { problemContext: record.problemContext } : {}),
          evidence,
        },
      });
      agent.rawOutput = result.raw;
      agent.output = normalizeSpecialistOutput(result.parsed, evidence);
      this.completeAgent(agent, "completed");
    } catch (error) {
      agent.error = error instanceof Error ? error.message : String(error);
      this.completeAgent(agent, "failed");
    }
    record.updatedAt = new Date().toISOString();
    await this.persist(record);
  }

  private async runSynthesizer(
    record: MediaInvestigationRecord,
    agent: MediaInvestigationAgentRun,
    evidence: MediaEvidenceBundle,
    specialists: MediaInvestigationAgentRun[],
  ): Promise<void> {
    await this.startAgent(record, agent);
    try {
      const origin = await this.streamer.inspectOrigin(record.originId);
      const tools = typeof origin.rootDir === "string"
        ? await createMediaInvestigationTools({
            origin,
            callbacks: {
              onActivity: async (activity) => {
                const index = record.activities.findIndex((item) => item.id === activity.id);
                if (index >= 0) record.activities[index] = { ...activity };
                else record.activities.push({ ...activity });
                record.updatedAt = new Date().toISOString();
                await this.persist(record);
              },
              onEvidence: async (activeEvidence) => {
                evidence.derived.contentQa.push(activeEvidence);
                evidence.evidenceIndex.push({
                  id: activeEvidence.id,
                  kind: "derived",
                  summary: activeEvidence.summary,
                });
                record.updatedAt = new Date().toISOString();
                await this.persist(record);
              },
            },
          }).catch((error) => {
            kaelLogger.warn("media.investigation.tools_unavailable", {
              investigationId: record.id,
              error: error instanceof Error ? error.message : String(error),
            });
            return [];
          })
        : [];
      const result = await this.runner.run({
        prompt: agent.prompt,
        input: {
          investigationId: record.id,
          problemStatement: record.problemStatement,
          ...(record.problemContext ? { problemContext: record.problemContext } : {}),
          evidence,
          specialistReports: specialists.map((item) => ({
            id: item.id,
            label: item.label,
            output: item.output!,
          })),
        },
        tools,
      });
      agent.rawOutput = result.raw;
      agent.synthesis = normalizeSynthesis(result.parsed, evidence, specialists);
      this.completeAgent(agent, "completed");
    } catch (error) {
      agent.error = error instanceof Error ? error.message : String(error);
      this.completeAgent(agent, "failed");
    }
    record.updatedAt = new Date().toISOString();
    await this.persist(record);
  }

  private async startAgent(record: MediaInvestigationRecord, agent: MediaInvestigationAgentRun): Promise<void> {
    agent.state = "running";
    agent.startedAt = new Date().toISOString();
    record.updatedAt = agent.startedAt;
    await this.persist(record);
  }

  private completeAgent(agent: MediaInvestigationAgentRun, state: "completed" | "failed"): void {
    agent.state = state;
    agent.completedAt = new Date().toISOString();
    if (agent.startedAt) {
      agent.durationMs = Math.max(0, Date.parse(agent.completedAt) - Date.parse(agent.startedAt));
    }
  }

  private async transition(record: MediaInvestigationRecord, state: MediaInvestigationRecord["state"]): Promise<void> {
    record.state = state;
    record.updatedAt = new Date().toISOString();
    await this.persist(record);
  }

  private async loadPrompt(definition: SpecialistDefinition): Promise<MediaAgentPromptSnapshot> {
    const filePath = path.join(this.promptDir, definition.fileName);
    const content = (await fs.readFile(filePath, "utf-8")).trim();
    const versionMatch = content.match(/^version:\s*(.+)$/im);
    return {
      path: filePath,
      version: versionMatch?.[1]?.trim() || "unversioned",
      hash: createHash("sha256").update(content).digest("hex").slice(0, 16),
      content,
    };
  }

  private persist(record: MediaInvestigationRecord): Promise<void> {
    const previous = this.persistQueues.get(record.id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => writeJsonFile(path.join(this.rootDir, `${record.id}.json`), record));
    this.persistQueues.set(record.id, next);
    return next.finally(() => {
      if (this.persistQueues.get(record.id) === next) this.persistQueues.delete(record.id);
    });
  }
}

function normalizeSpecialistOutput(value: unknown, evidence: MediaEvidenceBundle): MediaSpecialistOutput {
  const input = asRecord(value);
  const validEvidence = new Set(evidence.evidenceIndex.map((item) => item.id));
  return {
    summary: asString(input.summary, "Sem resumo fornecido."),
    findings: asArray(input.findings).map((item) => normalizeFinding(item, validEvidence)).slice(0, 20),
    hypotheses: asArray(input.hypotheses).map((item) => normalizeHypothesis(item, validEvidence)).slice(0, 12),
    requestedChecks: asStringArray(input.requestedChecks).slice(0, 12),
    limitations: asStringArray(input.limitations).slice(0, 12),
  };
}

function normalizeFinding(value: unknown, validEvidence: Set<string>): MediaFinding {
  const input = asRecord(value);
  const severity = input.severity === "error" || input.severity === "warning" ? input.severity : "info";
  return {
    code: asString(input.code, "uncategorized"),
    severity,
    confidence: confidence(input.confidence),
    summary: asString(input.summary, "Finding sem resumo."),
    evidenceIds: asStringArray(input.evidenceIds).filter((id) => validEvidence.has(id)),
  };
}

function normalizeHypothesis(value: unknown, validEvidence: Set<string>): MediaHypothesis {
  const input = asRecord(value);
  const likelyStage = typeof input.likelyStage === "string" && input.likelyStage.trim()
    ? input.likelyStage.trim()
    : undefined;
  return {
    code: asString(input.code, "uncategorized_hypothesis"),
    description: asString(input.description, "Hipotese sem descricao."),
    ...(likelyStage ? { likelyStage } : {}),
    confidence: calibratedHypothesisConfidence(input, validEvidence),
    supportingEvidenceIds: validEvidenceIds(input.supportingEvidenceIds, validEvidence),
    contradictingEvidenceIds: validEvidenceIds(input.contradictingEvidenceIds, validEvidence),
    explainedEvidenceIds: validEvidenceIds(input.explainedEvidenceIds, validEvidence),
    unexplainedEvidenceIds: validEvidenceIds(input.unexplainedEvidenceIds, validEvidence),
    predictedObservations: asStringArray(input.predictedObservations).slice(0, 12),
    causalChain: asStringArray(input.causalChain).slice(0, 12),
  };
}

function normalizeSynthesis(
  value: unknown,
  evidence: MediaEvidenceBundle,
  specialists: MediaInvestigationAgentRun[],
): MediaInvestigationSynthesis {
  const input = asRecord(value);
  const validEvidence = new Set(evidence.evidenceIndex.map((item) => item.id));
  const rankedHypotheses = asArray(input.rankedHypotheses).map((value) => {
    const hypothesis = asRecord(value);
    const explainedEvidenceIds = validEvidenceIds(hypothesis.explainedEvidenceIds, validEvidence);
    const contradictingEvidenceIds = validEvidenceIds(hypothesis.contradictingEvidenceIds, validEvidence);
    let hypothesisConfidence = confidence(hypothesis.confidence);
    if (explainedEvidenceIds.length === 0) hypothesisConfidence = Math.min(hypothesisConfidence, 0.5);
    if (contradictingEvidenceIds.length > 0) hypothesisConfidence = Math.min(hypothesisConfidence, 0.75);
    return {
      code: asString(hypothesis.code, "uncategorized_hypothesis"),
      description: asString(hypothesis.description, "Hipotese sem descricao."),
      confidence: hypothesisConfidence,
      explainedEvidenceIds,
      contradictingEvidenceIds,
    };
  }).slice(0, 8);
  const specialistEvidenceIds = new Set(
    specialists.flatMap((specialist) => specialist.output?.findings.flatMap((finding) => finding.evidenceIds) ?? []),
  );
  const allExplained = new Set(rankedHypotheses.flatMap((hypothesis) => hypothesis.explainedEvidenceIds));
  const computedUnresolved = [...specialistEvidenceIds].filter((id) => !allExplained.has(id));
  const unresolvedEvidenceIds = [...new Set([
    ...validEvidenceIds(input.unresolvedEvidenceIds, validEvidence),
    ...computedUnresolved,
  ])].slice(0, 30);
  const evidenceCoverage = specialistEvidenceIds.size === 0
    ? confidence(input.evidenceCoverage)
    : [...specialistEvidenceIds].filter((id) => allExplained.has(id)).length / specialistEvidenceIds.size;
  let synthesisConfidence = confidence(input.confidence);
  if (rankedHypotheses.length === 0 || rankedHypotheses[0]?.explainedEvidenceIds.length === 0) {
    synthesisConfidence = Math.min(synthesisConfidence, 0.5);
  }
  if (unresolvedEvidenceIds.length > 0) synthesisConfidence = Math.min(synthesisConfidence, 0.8);
  if (evidenceCoverage < 0.5) synthesisConfidence = Math.min(synthesisConfidence, 0.6);
  return {
    summary: asString(input.summary, "Sem sintese fornecida."),
    likelyCause: asString(input.likelyCause, "Causa provavel indeterminada."),
    confidence: synthesisConfidence,
    perceptualImpact: asString(input.perceptualImpact, "Impacto perceptual nao determinado."),
    causalChain: asStringArray(input.causalChain).slice(0, 12),
    evidenceCoverage,
    unresolvedEvidenceIds,
    rankedHypotheses,
    consensus: asStringArray(input.consensus).slice(0, 12),
    disagreements: asStringArray(input.disagreements).slice(0, 12),
    nextSteps: asStringArray(input.nextSteps).slice(0, 12),
  };
}

function calibratedHypothesisConfidence(input: Record<string, unknown>, validEvidence: Set<string>): number {
  const support = validEvidenceIds(input.supportingEvidenceIds, validEvidence);
  const explained = validEvidenceIds(input.explainedEvidenceIds, validEvidence);
  const contradictions = validEvidenceIds(input.contradictingEvidenceIds, validEvidence);
  const unexplained = validEvidenceIds(input.unexplainedEvidenceIds, validEvidence);
  let result = confidence(input.confidence);
  if (support.length === 0 && explained.length === 0) result = Math.min(result, 0.5);
  if (contradictions.length > 0) result = Math.min(result, 0.75);
  if (unexplained.length > 0) result = Math.min(result, 0.8);
  return result;
}

function validEvidenceIds(value: unknown, validEvidence: Set<string>): string[] {
  return asStringArray(value).filter((id) => validEvidence.has(id)).slice(0, 30);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function confidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function signedSeconds(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}s`;
}
