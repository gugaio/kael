import type { VideoHlsInspectResult, VideoInspectToolService } from "./inspect-service.js";
import type { HlsManifestAuditInput, HlsManifestAuditReport, ManifestAuditIssue, PlaybackIssueSeverity } from "./types.js";

type HlsInspectLike = Pick<VideoInspectToolService, "inspectHls">;

export class VideoManifestAuditService {
  constructor(private readonly inspect: HlsInspectLike) {}

  async auditHlsManifest(input: HlsManifestAuditInput): Promise<HlsManifestAuditReport> {
    const inspected = await this.inspect.inspectHls({
      url: input.url,
      maxSegments: input.maxSegments,
      timeoutMs: input.timeoutMs,
    });

    const issues = buildIssues(inspected);
    const recommendations = buildRecommendations(inspected, issues);
    const segmentDurations = inspected.segments
      .map((segment) => segment.duration)
      .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration));

    return {
      ok: !issues.some((issue) => issue.severity === "error"),
      url: inspected.url,
      finalUrl: inspected.finalUrl,
      playlistType: inspected.playlistType,
      summary: buildSummary(inspected, issues),
      stats: {
        variants: inspected.variants.length,
        renditions: inspected.renditions.length,
        segments: inspected.segments.length,
        targetDuration: inspected.targetDuration,
        maxSegmentDuration: segmentDurations.length > 0 ? Math.max(...segmentDurations) : undefined,
        minSegmentDuration: segmentDurations.length > 0 ? Math.min(...segmentDurations) : undefined,
        averageSegmentDuration:
          segmentDurations.length > 0
            ? segmentDurations.reduce((acc, duration) => acc + duration, 0) / segmentDurations.length
            : undefined,
      },
      issues,
      recommendations,
    };
  }
}

function buildIssues(inspected: VideoHlsInspectResult): ManifestAuditIssue[] {
  const issues: ManifestAuditIssue[] = [];

  for (const error of inspected.errors) {
    issues.push({
      code: "inspect_error",
      severity: "error",
      summary: `Falha estrutural detectada na leitura do manifesto: ${error}.`,
      evidence: [error],
    });
  }

  if (inspected.playlistType === "unknown") {
    issues.push({
      code: "unknown_playlist_type",
      severity: "error",
      summary: "O manifesto nao foi reconhecido como HLS master nem media playlist.",
      evidence: [inspected.finalUrl],
    });
    return issues;
  }

  if (inspected.playlistType === "master") {
    issues.push(...buildMasterIssues(inspected));
  }

  if (inspected.playlistType === "media") {
    issues.push(...buildMediaIssues(inspected));
  }

  return issues;
}

function buildMasterIssues(inspected: VideoHlsInspectResult): ManifestAuditIssue[] {
  const issues: ManifestAuditIssue[] = [];

  if (inspected.variants.length === 0) {
    issues.push({
      code: "master_without_variants",
      severity: "error",
      summary: "A master playlist nao declara nenhuma variant stream.",
      evidence: [inspected.finalUrl],
    });
    return issues;
  }

  if (inspected.variants.length === 1) {
    issues.push({
      code: "single_variant_ladder",
      severity: "warning",
      summary: "A master playlist expoe apenas uma variant, reduzindo resiliencia de ABR.",
      evidence: [formatVariantEvidence(inspected.variants[0])],
    });
  }

  const variantsWithoutBandwidth = inspected.variants.filter((variant) => !variant.bandwidth);
  if (variantsWithoutBandwidth.length > 0) {
    issues.push({
      code: "variant_missing_bandwidth",
      severity: "warning",
      summary: `${variantsWithoutBandwidth.length} variant(s) nao declaram BANDWIDTH.`,
      evidence: variantsWithoutBandwidth.slice(0, 3).map((variant) => variant.uri),
    });
  }

  const variantsWithoutCodecs = inspected.variants.filter((variant) => !variant.codecs?.trim());
  if (variantsWithoutCodecs.length > 0) {
    issues.push({
      code: "variant_missing_codecs",
      severity: "warning",
      summary: `${variantsWithoutCodecs.length} variant(s) nao declaram CODECS, o que dificulta compatibilidade e troubleshooting.`,
      evidence: variantsWithoutCodecs.slice(0, 3).map((variant) => variant.uri),
    });
  }

  const audioGroups = new Set(inspected.renditions.filter((rendition) => rendition.type === "AUDIO").map((r) => r.groupId));
  const variantsWithMissingAudioGroup = inspected.variants.filter(
    (variant) => variant.audioGroupId && !audioGroups.has(variant.audioGroupId),
  );
  if (variantsWithMissingAudioGroup.length > 0) {
    issues.push({
      code: "missing_audio_group_rendition",
      severity: "error",
      summary: "Uma ou mais variants referenciam grupo de audio inexistente em EXT-X-MEDIA.",
      evidence: variantsWithMissingAudioGroup.slice(0, 3).map((variant) => formatVariantEvidence(variant)),
    });
  }

  return issues;
}

function buildMediaIssues(inspected: VideoHlsInspectResult): ManifestAuditIssue[] {
  const issues: ManifestAuditIssue[] = [];
  const segmentDurations = inspected.segments
    .map((segment) => segment.duration)
    .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration));

  if (inspected.segments.length === 0) {
    issues.push({
      code: "media_without_segments",
      severity: "error",
      summary: "A media playlist nao expoe nenhum segmento util nos primeiros itens lidos.",
      evidence: [inspected.finalUrl],
    });
    return issues;
  }

  if (typeof inspected.targetDuration !== "number") {
    issues.push({
      code: "missing_target_duration",
      severity: "error",
      summary: "A media playlist nao declara EXT-X-TARGETDURATION.",
      evidence: [inspected.finalUrl],
    });
  }

  if (typeof inspected.targetDuration === "number" && inspected.targetDuration > 12) {
    issues.push({
      code: "high_target_duration",
      severity: "warning",
      summary: `A playlist usa TARGETDURATION=${inspected.targetDuration}, sugerindo segmentos longos para playback adaptativo.`,
      evidence: [`targetDuration=${inspected.targetDuration}`],
    });
  }

  if (segmentDurations.length === 0) {
    issues.push({
      code: "segments_missing_extinf",
      severity: "warning",
      summary: "Os segmentos auditados nao possuem duracao parsavel via EXTINF.",
      evidence: inspected.segments.slice(0, 3).map((segment) => segment.uri),
    });
    return issues;
  }

  if (typeof inspected.targetDuration === "number") {
    const targetDuration = inspected.targetDuration;
    const oversized = inspected.segments.filter(
      (segment) => typeof segment.duration === "number" && segment.duration > targetDuration + 0.5,
    );
    if (oversized.length > 0) {
      issues.push({
        code: "segment_exceeds_target_duration",
        severity: "error",
        summary: `${oversized.length} segmento(s) excedem TARGETDURATION de forma relevante.`,
        evidence: oversized.slice(0, 3).map((segment) => formatSegmentEvidence(segment)),
      });
    }
  }

  const maxDuration = Math.max(...segmentDurations);
  const minDuration = Math.min(...segmentDurations);
  if (maxDuration - minDuration > 3) {
    issues.push({
      code: "segment_duration_variation",
      severity: "warning",
      summary: "Os primeiros segmentos apresentam variacao alta de duracao, o que pode afetar latencia e estabilidade de ABR.",
      evidence: [`min=${minDuration.toFixed(3)}s`, `max=${maxDuration.toFixed(3)}s`],
    });
  }

  return issues;
}

function buildSummary(inspected: VideoHlsInspectResult, issues: ManifestAuditIssue[]): string {
  const severity = highestSeverity(issues);
  if (inspected.playlistType === "master") {
    return `Auditoria de manifesto HLS master concluida com status ${severity}. variants=${inspected.variants.length}, renditions=${inspected.renditions.length}.`;
  }
  if (inspected.playlistType === "media") {
    return `Auditoria de manifesto HLS media concluida com status ${severity}. segments=${inspected.segments.length}, targetDuration=${inspected.targetDuration ?? "n/a"}.`;
  }
  return `Auditoria de manifesto HLS concluida com status ${severity}.`;
}

function buildRecommendations(inspected: VideoHlsInspectResult, issues: ManifestAuditIssue[]): string[] {
  const recommendations = new Set<string>();

  if (issues.some((issue) => issue.code === "master_without_variants" || issue.code === "single_variant_ladder")) {
    recommendations.add("Revisar a ladder ABR e garantir mais de uma variant para degradacao controlada de bitrate.");
  }
  if (issues.some((issue) => issue.code === "variant_missing_bandwidth" || issue.code === "variant_missing_codecs")) {
    recommendations.add("Normalizar tags de variant (BANDWIDTH, CODECS, RESOLUTION) no packager para melhorar compatibilidade e observabilidade.");
  }
  if (issues.some((issue) => issue.code === "missing_audio_group_rendition")) {
    recommendations.add("Corrigir o mapeamento entre EXT-X-STREAM-INF:AUDIO e EXT-X-MEDIA para evitar falhas de selecao de trilha.");
  }
  if (issues.some((issue) => issue.code === "missing_target_duration" || issue.code === "segment_exceeds_target_duration")) {
    recommendations.add("Validar segmentacao no encoder/packager e alinhar EXTINF/TARGETDURATION com a duracao real dos segmentos.");
  }
  if (issues.some((issue) => issue.code === "high_target_duration" || issue.code === "segment_duration_variation")) {
    recommendations.add("Revisar tamanho dos segmentos e consistencia do GOP para reduzir latencia e oscilacao de playback.");
  }
  if (issues.some((issue) => issue.severity === "error")) {
    recommendations.add("Cruzar este manifesto com `video_probe` e com a sessao de playback afetada antes de liberar para producao.");
  }
  if (recommendations.size === 0) {
    recommendations.add("Manifesto sem sinais fortes de erro estrutural nos checks atuais; seguir com validacao em player/device real.");
  }

  if (inspected.playlistType === "master") {
    recommendations.add("Auditar ao menos uma media playlist derivada de cada variant critica para validar segmentos reais.");
  }

  return [...recommendations];
}

function highestSeverity(issues: ManifestAuditIssue[]): PlaybackIssueSeverity {
  if (issues.some((issue) => issue.severity === "error")) return "error";
  if (issues.some((issue) => issue.severity === "warning")) return "warning";
  return "info";
}

function formatVariantEvidence(variant: VideoHlsInspectResult["variants"][number]): string {
  return `${variant.uri} bandwidth=${variant.bandwidth ?? "n/a"} codecs=${variant.codecs ?? "n/a"} resolution=${variant.resolution ?? "n/a"}`;
}

function formatSegmentEvidence(segment: VideoHlsInspectResult["segments"][number]): string {
  return `${segment.uri} duration=${typeof segment.duration === "number" ? segment.duration.toFixed(3) : "n/a"}s`;
}
