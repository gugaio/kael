import fs from "node:fs/promises";
import path from "node:path";
import {
  type StreamerCloneDiagnostic,
  type StreamerCloneResult,
  type StreamerClonedRendition,
  type StreamerClonedVariant,
  type StreamerOriginAnalysisReport,
  type StreamerOriginProbeReport,
  type StreamerOriginSummary,
} from "../capabilities/video/index.js";
import { formatBytes, formatSeconds, highlight } from "./cli-utils.js";

export type StreamerFileProbe = {
  manifestCount: number;
  manifestsOk: number;
  segmentCount: number;
  segmentsOk: number;
  mapCount: number;
  mapsOk: number;
  missing: string[];
};

export type StreamerProbeSummary = {
  sampled: number;
  total: number;
  ok: number;
  failed: number;
};
export function formatStreamerOriginSummary(origin: StreamerOriginSummary): string {
  return [
    origin.id,
    `created=${origin.createdAt}`,
    `schema=${origin.schemaVersion}`,
    `variants=${origin.variantCount}`,
    `renditions=${origin.renditionCount}`,
    `segments=${origin.segmentCount}`,
    `window=${formatSeconds(origin.requestedStartSeconds ?? 0)}->${formatSeconds((origin.requestedStartSeconds ?? 0) + origin.requestedDurationSeconds)}`,
    `duration=${formatSeconds(origin.cumulativeDurationSeconds)}/${origin.requestedDurationSeconds}s`,
    `bytes=${formatBytes(origin.bytes)}`,
    `allVariants=${origin.allVariants}`,
    ...(origin.faults.length > 0
      ? [
          `fault=${origin.faults
            .map((fault) => `${fault.type}:${fault.targetKind}[${fault.targetIndex}]:seg${fault.segmentIndex}`)
            .join(",")}`,
        ]
      : []),
    ...(origin.derivedFrom ? [`derivedFrom=${origin.derivedFrom}`] : []),
    `source=${origin.sourceUrl}`,
  ].join(" | ");
}

export function formatClonedVariantLabel(variant: StreamerClonedVariant): string {
  const parts = [
    variant.variant?.resolution,
    typeof variant.variant?.bandwidth === "number" ? `${variant.variant.bandwidth}bps` : undefined,
    variant.variant?.codecs,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" | ") : variant.sourceUri;
}

function formatClonedRenditionLabel(rendition: StreamerClonedRendition): string {
  return [
    rendition.type.toUpperCase(),
    rendition.groupId,
    rendition.name,
    rendition.channels ? `${rendition.channels}ch` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatUnknownList(values: string[]): string {
  return values.length > 0 ? values.join(",") : "unknown";
}

export async function buildStreamerFileProbe(origin: StreamerCloneResult): Promise<StreamerFileProbe> {
  const manifestPaths = new Set([
    origin.manifestPath,
    ...origin.variants.map((variant) => variant.manifestPath),
    ...origin.renditions.map((rendition) => rendition.manifestPath),
  ]);
  const segmentPaths = [
    ...origin.variants.flatMap((variant) =>
      variant.segments.map((segment) => path.join(path.dirname(variant.manifestPath), segment.localUri)),
    ),
    ...origin.renditions.flatMap((rendition) =>
      rendition.segments.map((segment) => path.join(path.dirname(rendition.manifestPath), segment.localUri)),
    ),
  ];
  const mapPaths = [
    ...origin.variants.flatMap((variant) =>
      variant.maps.map((map) => path.join(path.dirname(variant.manifestPath), map.localUri)),
    ),
    ...origin.renditions.flatMap((rendition) =>
      rendition.maps.map((map) => path.join(path.dirname(rendition.manifestPath), map.localUri)),
    ),
  ];

  const manifests = await countExistingFiles([...manifestPaths]);
  const segments = await countExistingFiles([...new Set(segmentPaths)]);
  const maps = await countExistingFiles([...new Set(mapPaths)]);

  return {
    manifestCount: manifestPaths.size,
    manifestsOk: manifests.ok,
    segmentCount: new Set(segmentPaths).size,
    segmentsOk: segments.ok,
    mapCount: new Set(mapPaths).size,
    mapsOk: maps.ok,
    missing: [...manifests.missing, ...segments.missing, ...maps.missing],
  };
}

async function countExistingFiles(filePaths: string[]): Promise<{ ok: number; missing: string[] }> {
  let ok = 0;
  const missing: string[] = [];

  for (const filePath of filePaths) {
    try {
      await fs.access(filePath);
      ok += 1;
    } catch {
      missing.push(filePath);
    }
  }

  return { ok, missing };
}

export function formatStreamerDiagnosticSummary(
  diagnostic: StreamerCloneDiagnostic,
  fileProbe: StreamerFileProbe,
  ffprobeSummary?: StreamerProbeSummary,
): string[] {
  const missingCount = fileProbe.missing.length;
  return [
    `diagnostic.browserCompatible=${diagnostic.browserCompatibility}`,
    `diagnostic.compatibleVariants=${diagnostic.browserCompatibleVariantCount}/${diagnostic.variantCount}`,
    `diagnostic.videoCodecs=${formatUnknownList(diagnostic.videoCodecs)}`,
    `diagnostic.audioCodecs=${formatUnknownList(diagnostic.audioCodecs)}`,
    `diagnostic.externalAudio=${diagnostic.externalAudio ? "yes" : "no"}`,
    `diagnostic.externalSubtitles=${diagnostic.externalSubtitles ? "yes" : "no"}`,
    `diagnostic.renditions=audio ${diagnostic.audioRenditionCount}, subtitles ${diagnostic.subtitleRenditionCount}`,
    `diagnostic.files=manifests ${fileProbe.manifestsOk}/${fileProbe.manifestCount}, segments ${fileProbe.segmentsOk}/${fileProbe.segmentCount}, maps ${fileProbe.mapsOk}/${fileProbe.mapCount}`,
    ...(ffprobeSummary
      ? [`diagnostic.ffprobe=ok ${ffprobeSummary.ok}/${ffprobeSummary.sampled} sampled=${ffprobeSummary.sampled}/${ffprobeSummary.total} failed=${ffprobeSummary.failed}`]
      : []),
    `diagnostic.issues=${diagnostic.issues.length + missingCount}`,
  ];
}

export function formatStreamerProbeReport(
  origin: StreamerCloneResult,
  diagnostic: StreamerCloneDiagnostic,
  fileProbe: StreamerFileProbe,
  ffprobeReport: StreamerOriginProbeReport,
): string[] {
  return [
    `${highlight("streamer probe")}: ${origin.id}`,
    ...formatStreamerDiagnosticSummary(diagnostic, fileProbe, toStreamerProbeSummary(ffprobeReport)),
    "variants:",
    ...diagnostic.variants.map(
      (variant) =>
        `- [${variant.index}] browser=${variant.browserStatus} | audio=${formatUnknownList(variant.audioCodecs)} | video=${formatUnknownList(variant.videoCodecs)} | group=${variant.audioGroupId ?? "none"} | ${variant.label}`,
    ),
    ...(origin.renditions.length > 0
      ? [
          "renditions:",
          ...origin.renditions.map((rendition, index) => `- [${index}] ${formatClonedRenditionLabel(rendition)}`),
        ]
      : []),
    ...(diagnostic.issues.length > 0 || fileProbe.missing.length > 0
      ? [
          "issues:",
          ...diagnostic.issues.map(
            (issue) => `- [${issue.severity}] ${issue.code}: ${issue.summary} (${issue.evidence.join(" | ")})`,
          ),
          ...fileProbe.missing.map((filePath) => `- [error] missing_file: ${filePath}`),
        ]
      : []),
    ...(ffprobeReport.entries.length > 0
      ? [
          "ffprobe:",
          ...ffprobeReport.entries.map(
            (entry) =>
              `- [${entry.ok ? "ok" : "error"}] ${entry.kind}[${entry.index}] ${entry.type} | streams=${entry.streamCount} | ${entry.label}${entry.errors.length > 0 ? ` | errors=${entry.errors.join(" ; ")}` : ""}`,
          ),
        ]
      : []),
    ...(diagnostic.recommendations.length > 0
      ? ["recommendations:", ...diagnostic.recommendations.map((item) => `- ${item}`)]
      : []),
  ];
}

export function toStreamerProbeSummary(report: StreamerOriginProbeReport): StreamerProbeSummary {
  return {
    sampled: report.sampledMediaPlaylists,
    total: report.totalMediaPlaylists,
    ok: report.okCount,
    failed: report.failedCount,
  };
}

export function formatStreamerAnalyzeReport(report: StreamerOriginAnalysisReport): string[] {
  return [
    `${highlight("streamer analyze")}: ${report.originId}`,
    `segments=${report.okSegments}/${report.sampledSegments} sampled playlists=${report.sampledMediaPlaylists}/${report.totalMediaPlaylists} failed=${report.failedSegments}`,
    `audioVideoAlignment=${report.avAlignment.status} compared=${report.avAlignment.comparedPairs} durationDeltaMax=${formatOptionalSeconds(report.avAlignment.maxDurationDeltaSeconds)} ptsStartDeltaMax=${formatOptionalSeconds(report.avAlignment.maxStartPtsDeltaSeconds)}${report.avAlignment.notes.length > 0 ? ` notes=${report.avAlignment.notes.join(" ; ")}` : ""}`,
    `issues=${report.issues.length}`,
    ...(report.issues.length > 0
      ? [
          "issues:",
          ...report.issues.map(
            (issue) =>
              `- [${issue.severity}] ${issue.code}: ${issue.summary}${issue.evidence.length > 0 ? ` (${issue.evidence.join(" | ")})` : ""}`,
          ),
        ]
      : []),
    "media:",
    ...report.media.map((media) => [
      `- [${media.boundaryStatus}] ${media.kind}[${media.mediaIndex}] ${media.type}`,
      `segments=${media.sampledSegments}`,
      `durationDeltaMax=${formatOptionalSeconds(media.durationDeltaMaxSeconds)}`,
      `durationDeltaAvg=${formatOptionalSeconds(media.durationDeltaAverageSeconds)}`,
      `boundaryDeltaMax=${formatOptionalSeconds(media.boundaryDeltaMaxSeconds)}`,
      ...(media.gopStatus ? [`gop=${media.gopStatus}`] : []),
      ...(typeof media.maxKeyframeGapSeconds === "number" ? [`maxKeyframeGap=${media.maxKeyframeGapSeconds.toFixed(3)}s`] : []),
      ...(typeof media.startsWithKeyframeFailures === "number" ? [`startsWithKeyframeFailures=${media.startsWithKeyframeFailures}`] : []),
      media.label,
    ].join(" | ")),
    "segments:",
    ...report.entries.map((entry) => [
      `- [${entry.ok ? "ok" : "error"}] ${entry.kind}[${entry.mediaIndex}] seg[${entry.segmentIndex}] ${entry.type}`,
      `declared=${entry.declaredDurationSeconds?.toFixed(3) ?? "n/a"}s`,
      `actual=${entry.actualDurationSeconds?.toFixed(3) ?? "n/a"}s`,
      ...(typeof entry.timelineStartSeconds === "number" && typeof entry.timelineEndSeconds === "number"
        ? [`assetTime=${formatSeconds(entry.timelineStartSeconds)}->${formatSeconds(entry.timelineEndSeconds)}`]
        : []),
      `durationDelta=${formatOptionalSignedSeconds(entry.durationDeltaSeconds)}`,
      `pts=${entry.firstPtsTime?.toFixed(3) ?? "n/a"} -> ${entry.lastPtsTime?.toFixed(3) ?? "n/a"}`,
      `boundary=${entry.boundaryStatus ?? "unknown"}`,
      ...(typeof entry.boundaryDeltaSeconds === "number" ? [`boundaryDelta=${formatOptionalSignedSeconds(entry.boundaryDeltaSeconds)}`] : []),
      ...(entry.type === "AUDIO" ? [`audioContinuity=${entry.continuityStatus ?? "unknown"}`] : []),
      ...(typeof entry.nextDeltaUs === "number" ? [`audioDelta=${formatMicroseconds(entry.nextDeltaUs)}`] : []),
      ...(typeof entry.nextExpectedPtsUs === "number" && typeof entry.nextActualPtsUs === "number"
        ? [`expected=${entry.nextExpectedPtsUs}us actual=${entry.nextActualPtsUs}us`]
        : []),
      `samples=${entry.packetCount ?? 0}`,
      ...(typeof entry.keyframeCount === "number" ? [`keyframes=${entry.keyframeCount}`] : []),
      ...(typeof entry.startsWithKeyframe === "boolean" ? [`startsWithKeyframe=${entry.startsWithKeyframe ? "yes" : "no"}`] : []),
      ...(typeof entry.maxKeyframeGapSeconds === "number"
        ? [`maxKeyframeGap=${entry.maxKeyframeGapSeconds.toFixed(3)}s`]
        : []),
      entry.label,
      ...(entry.errors.length > 0 ? [`errors=${entry.errors.join(" ; ")}`] : []),
    ].join(" | ")),
  ];
}

function formatOptionalSeconds(value: number | undefined): string {
  return typeof value === "number" ? `${value.toFixed(3)}s` : "n/a";
}

function formatOptionalSignedSeconds(value: number | undefined): string {
  if (typeof value !== "number") {
    return "n/a";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}s`;
}

function formatMicroseconds(value: number): string {
  return `${(value / 1_000).toFixed(3)}ms`;
}
