import type {
  HlsManifestAuditInput,
  HlsManifestAuditReport,
  HlsManifestDiffInput,
  HlsManifestDiffReport,
  HlsVariantAuditReport,
  HlsVariantDiffEntry,
  ManifestAuditIssue,
} from "./types.js";

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
    const variantDiff = diffVariants(left.variantAudits, right.variantAudits);
    const recommendations = buildRecommendations(left, right, issueDiff, aggregateIssueDiff, variantDiff);

    return {
      ok: issueDiff.added.every((issue) => issue.severity !== "error") &&
        aggregateIssueDiff.added.every((issue) => issue.severity !== "error") &&
        variantDiff.regressed.length === 0,
      summary: buildSummary(left, right, issueDiff, aggregateIssueDiff, variantDiff),
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
      variantDiff,
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
  variantDiff: HlsManifestDiffReport["variantDiff"],
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
  if (variantDiff.regressed.length > 0) {
    parts.push(`${variantDiff.regressed.length} variant(s) regrediram na ladder da direita`);
  }
  if (variantDiff.added.length > 0 || variantDiff.removed.length > 0) {
    parts.push(`${variantDiff.added.length} variant(s) adicionadas e ${variantDiff.removed.length} removidas`);
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
  variantDiff: HlsManifestDiffReport["variantDiff"],
): string[] {
  const out = new Set<string>();
  const changedOrRegressedVariants = [...variantDiff.changed, ...variantDiff.regressed];
  if (left.playlistType !== right.playlistType) {
    out.add("Verificar regressao estrutural do manifesto entre os dois ambientes/versoes.");
  }
  if ([...issueDiff.added, ...aggregateIssueDiff.added].some((issue) => issue.severity === "error")) {
    out.add("Priorizar as novas issues de severidade error antes de promover release.");
  }
  if (right.stats.variantsWithErrors > left.stats.variantsWithErrors) {
    out.add("Reauditar variants com erro e conferir ladder ABR publicada no ambiente da direita.");
  }
  if (variantDiff.regressed.length > 0) {
    out.add("Inspecionar as variants que regrediram e validar bitrate/resolution/targetDuration na ladder publicada.");
  }
  if (changedOrRegressedVariants.some((item) => item.changedFields.includes("audioGroupId"))) {
    out.add("Validar mudancas de grupo de audio nas variants e checar alinhamento com EXT-X-MEDIA/AUDIO.");
  }
  if (changedOrRegressedVariants.some((item) => item.changedFields.includes("subtitlesGroupId"))) {
    out.add("Validar mudancas de grupo de subtitles e conferir se as renditions continuam publicadas e vinculadas.");
  }
  if (variantDiff.added.length > 0 || variantDiff.removed.length > 0) {
    out.add("Conferir se as mudancas de ladder foram intencionais e compativeis com o catalogo ABR esperado.");
  }
  if (issueDiff.removed.length > 0 || aggregateIssueDiff.removed.length > 0) {
    out.add("Conferir se a melhora observada se repete nos manifests reais do ambiente alvo.");
  }
  if (out.size === 0) {
    out.add("Comparar novamente apos novas mudancas de empacotamento para confirmar estabilidade da ladder.");
  }
  return [...out];
}

function diffVariants(
  leftVariants: HlsVariantAuditReport[],
  rightVariants: HlsVariantAuditReport[],
): HlsManifestDiffReport["variantDiff"] {
  const remainingRight = [...rightVariants];
  const added: HlsVariantDiffEntry[] = [];
  const removed: HlsVariantDiffEntry[] = [];
  const changed: HlsVariantDiffEntry[] = [];
  const regressed: HlsVariantDiffEntry[] = [];
  const improved: HlsVariantDiffEntry[] = [];
  const unchanged: HlsVariantDiffEntry[] = [];

  for (const left of leftVariants) {
    const matchIndex = findVariantMatchIndex(left, remainingRight);
    if (matchIndex < 0) {
      removed.push(buildAddedOrRemovedVariant("removed", left));
      continue;
    }
    const right = remainingRight.splice(matchIndex, 1)[0]!;
    const entry = buildMatchedVariantDiff(left, right);
    switch (entry.status) {
      case "regressed":
        regressed.push(entry);
        break;
      case "improved":
        improved.push(entry);
        break;
      case "changed":
        changed.push(entry);
        break;
      default:
        unchanged.push(entry);
        break;
    }
  }

  for (const right of remainingRight) {
    added.push(buildAddedOrRemovedVariant("added", right));
  }

  return { added, removed, changed, regressed, improved, unchanged };
}

function buildAddedOrRemovedVariant(
  status: "added" | "removed",
  variant: HlsVariantAuditReport,
): HlsVariantDiffEntry {
  return {
    matchKey: variantMatchKey(variant),
    status,
    regressionSeverity: status === "added" ? "low" : "medium",
    regressionScore: status === "added" ? 20 : 50,
    ...(status === "added" ? { right: variant } : { left: variant }),
    delta: {},
    issueDiff: {
      added: status === "added" ? variant.issues : [],
      removed: status === "removed" ? variant.issues : [],
      persisted: [],
    },
    changedFields: ["variant_presence"],
    summary:
      status === "added"
        ? `Variant adicionada na direita (${variantLabel(variant)})`
        : `Variant removida na direita (${variantLabel(variant)})`,
  };
}

function buildMatchedVariantDiff(left: HlsVariantAuditReport, right: HlsVariantAuditReport): HlsVariantDiffEntry {
  const issueDiff = diffIssues(left.issues, right.issues);
  const changedFields = collectChangedFields(left, right);
  const delta = {
    targetDuration: diffOptionalNumber(left.stats.targetDuration, right.stats.targetDuration),
    minSegmentDuration: diffOptionalNumber(left.stats.minSegmentDuration, right.stats.minSegmentDuration),
    maxSegmentDuration: diffOptionalNumber(left.stats.maxSegmentDuration, right.stats.maxSegmentDuration),
    averageSegmentDuration: diffOptionalNumber(left.stats.averageSegmentDuration, right.stats.averageSegmentDuration),
    segments: right.stats.segments - left.stats.segments,
  };

  const status: HlsVariantDiffEntry["status"] =
    left.ok && !right.ok
      ? "regressed"
      : !left.ok && right.ok
        ? "improved"
        : changedFields.length > 0 || issueDiff.added.length > 0 || issueDiff.removed.length > 0 || delta.segments !== 0
          ? "changed"
          : "unchanged";

  const regressionScore = computeRegressionScore(status, issueDiff, changedFields, delta);
  const regressionSeverity = classifyRegressionSeverity(regressionScore);

  return {
    matchKey: variantMatchKey(left),
    status,
    regressionSeverity,
    regressionScore,
    left,
    right,
    delta,
    issueDiff,
    changedFields,
    summary: buildVariantDiffSummary(status, left, right, issueDiff, changedFields),
  };
}

function collectChangedFields(left: HlsVariantAuditReport, right: HlsVariantAuditReport): string[] {
  const fields: string[] = [];
  if (left.uri !== right.uri) fields.push("uri");
  if (left.playlistType !== right.playlistType) fields.push("playlistType");
  if (left.bandwidth !== right.bandwidth) fields.push("bandwidth");
  if (left.averageBandwidth !== right.averageBandwidth) fields.push("averageBandwidth");
  if (left.resolution !== right.resolution) fields.push("resolution");
  if (left.frameRate !== right.frameRate) fields.push("frameRate");
  if (left.codecs !== right.codecs) fields.push("codecs");
  if (left.audioGroupId !== right.audioGroupId) fields.push("audioGroupId");
  if (left.subtitlesGroupId !== right.subtitlesGroupId) fields.push("subtitlesGroupId");
  if (left.stats.targetDuration !== right.stats.targetDuration) fields.push("targetDuration");
  return fields;
}

function buildVariantDiffSummary(
  status: HlsVariantDiffEntry["status"],
  left: HlsVariantAuditReport,
  right: HlsVariantAuditReport,
  issueDiff: HlsVariantDiffEntry["issueDiff"],
  changedFields: string[],
): string {
  const base = variantLabel(left);
  if (status === "regressed") {
    const groupNotes = changedFields.filter((field) => field === "audioGroupId" || field === "subtitlesGroupId");
    return `Variant ${base} regrediu (${issueDiff.added.length} nova(s) issue(s), ok ${left.ok} -> ${right.ok}${groupNotes.length > 0 ? `, groups=${groupNotes.join(",")}` : ""})`;
  }
  if (status === "improved") {
    return `Variant ${base} melhorou (${issueDiff.removed.length} issue(s) removida(s), ok ${left.ok} -> ${right.ok})`;
  }
  if (status === "changed") {
    return `Variant ${base} mudou (${changedFields.join(", ") || "issues/stats"})`;
  }
  return `Variant ${base} sem mudancas relevantes`;
}

function findVariantMatchIndex(left: HlsVariantAuditReport, rightVariants: HlsVariantAuditReport[]): number {
  const exactUri = rightVariants.findIndex((item) => item.uri === left.uri);
  if (exactUri >= 0) return exactUri;

  const exactPath = rightVariants.findIndex((item) => extractComparablePath(item) === extractComparablePath(left));
  if (exactPath >= 0) return exactPath;

  const signature = variantSignature(left);
  return rightVariants.findIndex((item) => variantSignature(item) === signature);
}

function variantMatchKey(variant: HlsVariantAuditReport): string {
  return variant.uri || extractComparablePath(variant) || variantSignature(variant);
}

function extractComparablePath(variant: HlsVariantAuditReport): string {
  const candidates = [variant.finalUrl, variant.url];
  for (const candidate of candidates) {
    try {
      return new URL(candidate).pathname;
    } catch {
      continue;
    }
  }
  return "";
}

function variantSignature(variant: HlsVariantAuditReport): string {
  return [
    variant.resolution ?? "na",
    variant.bandwidth ?? "na",
    variant.averageBandwidth ?? "na",
    variant.codecs ?? "na",
  ].join("|");
}

function variantLabel(variant: HlsVariantAuditReport): string {
  return variant.uri || variant.resolution || variant.url;
}

function computeRegressionScore(
  status: HlsVariantDiffEntry["status"],
  issueDiff: HlsVariantDiffEntry["issueDiff"],
  changedFields: string[],
  delta: HlsVariantDiffEntry["delta"],
): number {
  let score = 0;
  if (status === "regressed") score += 60;
  if (status === "changed") score += 20;
  if (issueDiff.added.some((issue) => issue.severity === "error")) score += 30;
  if (issueDiff.added.some((issue) => issue.severity === "warning")) score += 10;
  if (changedFields.includes("audioGroupId")) score += 15;
  if (changedFields.includes("subtitlesGroupId")) score += 10;
  if (changedFields.includes("codecs")) score += 20;
  if (changedFields.includes("resolution")) score += 10;
  if (changedFields.includes("bandwidth")) score += 10;
  if (typeof delta.targetDuration === "number" && Math.abs(delta.targetDuration) >= 2) score += 10;
  if (typeof delta.averageSegmentDuration === "number" && Math.abs(delta.averageSegmentDuration) >= 1.5) score += 10;
  return Math.min(100, score);
}

function classifyRegressionSeverity(score: number): HlsVariantDiffEntry["regressionSeverity"] {
  if (score >= 80) return "high";
  if (score >= 45) return "medium";
  if (score > 0) return "low";
  return "none";
}
