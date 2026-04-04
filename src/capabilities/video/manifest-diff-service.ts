import type { HlsManifestAuditInput, HlsManifestAuditReport, HlsManifestDiffInput, HlsManifestDiffReport, ManifestAuditIssue } from "./types.js";

type HlsAuditLike = Pick<{ auditHlsManifest(input: HlsManifestAuditInput): Promise<HlsManifestAuditReport> }, "auditHlsManifest">;

export class VideoManifestDiffService {
  constructor(private readonly audit: HlsAuditLike) {}

  async diffHlsManifests(input: HlsManifestDiffInput): Promise<HlsManifestDiffReport> {
    const [left, right] = await Promise.all([
      this.audit.auditHlsManifest({
        sessionKey: `${input.sessionKey}:left`,
        url: input.leftUrl,
        maxSegments: input.maxSegments,
        timeoutMs: input.timeoutMs,
        followVariants: input.followVariants,
        maxVariants: input.maxVariants,
      }),
      this.audit.auditHlsManifest({
        sessionKey: `${input.sessionKey}:right`,
        url: input.rightUrl,
        maxSegments: input.maxSegments,
        timeoutMs: input.timeoutMs,
        followVariants: input.followVariants,
        maxVariants: input.maxVariants,
      }),
    ]);

    const issueDiff = diffIssues(left.issues, right.issues);
    const aggregateIssueDiff = diffIssues(left.aggregateIssues, right.aggregateIssues);
    const recommendations = buildRecommendations(left, right, issueDiff, aggregateIssueDiff);

    return {
      ok: issueDiff.added.every((issue) => issue.severity !== "error") &&
        aggregateIssueDiff.added.every((issue) => issue.severity !== "error"),
      summary: buildSummary(left, right, issueDiff, aggregateIssueDiff),
      left,
      right,
      delta: {
        variants: right.stats.variants - left.stats.variants,
        renditions: right.stats.renditions - left.stats.renditions,
        segments: right.stats.segments - left.stats.segments,
        variantsAudited: right.stats.variantsAudited - left.stats.variantsAudited,
        variantsWithErrors: right.stats.variantsWithErrors - left.stats.variantsWithErrors,
        targetDuration: diffOptionalNumber(left.stats.targetDuration, right.stats.targetDuration),
        minSegmentDuration: diffOptionalNumber(left.stats.minSegmentDuration, right.stats.minSegmentDuration),
        maxSegmentDuration: diffOptionalNumber(left.stats.maxSegmentDuration, right.stats.maxSegmentDuration),
        averageSegmentDuration: diffOptionalNumber(left.stats.averageSegmentDuration, right.stats.averageSegmentDuration),
      },
      playlistTypeChanged: left.playlistType !== right.playlistType,
      issueDiff,
      aggregateIssueDiff,
      recommendations,
    };
  }
}

function diffIssues(left: ManifestAuditIssue[], right: ManifestAuditIssue[]) {
  const leftMap = new Map(left.map((issue) => [issueKey(issue), issue]));
  const rightMap = new Map(right.map((issue) => [issueKey(issue), issue]));

  return {
    added: [...rightMap.entries()].filter(([key]) => !leftMap.has(key)).map(([, issue]) => issue),
    removed: [...leftMap.entries()].filter(([key]) => !rightMap.has(key)).map(([, issue]) => issue),
    persisted: [...rightMap.keys()].filter((key) => leftMap.has(key)),
  };
}

function issueKey(issue: ManifestAuditIssue): string {
  return `${issue.code}::${issue.summary}`;
}

function diffOptionalNumber(left?: number, right?: number): number | undefined {
  if (typeof left !== "number" || typeof right !== "number") {
    return undefined;
  }
  return right - left;
}

function buildSummary(
  left: HlsManifestAuditReport,
  right: HlsManifestAuditReport,
  issueDiff: HlsManifestDiffReport["issueDiff"],
  aggregateIssueDiff: HlsManifestDiffReport["aggregateIssueDiff"],
): string {
  const parts: string[] = [];
  if (left.playlistType !== right.playlistType) {
    parts.push(`playlistType mudou de ${left.playlistType} para ${right.playlistType}`);
  }
  if (issueDiff.added.length > 0 || aggregateIssueDiff.added.length > 0) {
    parts.push(
      `${issueDiff.added.length + aggregateIssueDiff.added.length} issue(s) nova(s) no manifesto da direita`,
    );
  }
  if (issueDiff.removed.length > 0 || aggregateIssueDiff.removed.length > 0) {
    parts.push(
      `${issueDiff.removed.length + aggregateIssueDiff.removed.length} issue(s) desapareceram no manifesto da direita`,
    );
  }
  if (parts.length === 0) {
    parts.push("manifests com perfil semelhante nas heuristicas auditadas");
  }
  return parts.join("; ");
}

function buildRecommendations(
  left: HlsManifestAuditReport,
  right: HlsManifestAuditReport,
  issueDiff: HlsManifestDiffReport["issueDiff"],
  aggregateIssueDiff: HlsManifestDiffReport["aggregateIssueDiff"],
): string[] {
  const out = new Set<string>();
  if (left.playlistType !== right.playlistType) {
    out.add("Verificar regressao estrutural do manifesto entre os dois ambientes/versoes.");
  }
  if ([...issueDiff.added, ...aggregateIssueDiff.added].some((issue) => issue.severity === "error")) {
    out.add("Priorizar as novas issues de severidade error antes de promover release.");
  }
  if (right.stats.variantsWithErrors > left.stats.variantsWithErrors) {
    out.add("Reauditar variants com erro e conferir ladder ABR publicada no ambiente da direita.");
  }
  if (issueDiff.removed.length > 0 || aggregateIssueDiff.removed.length > 0) {
    out.add("Conferir se a melhora observada se repete nos manifests reais do ambiente alvo.");
  }
  if (out.size === 0) {
    out.add("Persistir os dois audits como evidencia e comparar novamente apos novas mudancas de empacotamento.");
  }
  return [...out];
}
