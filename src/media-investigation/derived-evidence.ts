import type { StreamerOriginAnalysisReport } from "@gugaio/vhs";
import type { MediaAvOffsetSeries } from "./types.js";

const ALIGNED_OFFSET_SECONDS = 0.080;
const STABLE_SPREAD_SECONDS = 0.120;
const MATERIAL_OFFSET_SECONDS = 0.150;
const DRIFT_SECONDS = 0.250;
const DISCONTINUITY_SECONDS = 0.500;

type Entry = StreamerOriginAnalysisReport["entries"][number];

/**
 * Builds signed A/V PTS offset series. VHS remains the source of timestamps;
 * this investigation-level view makes cross-segment causal patterns explicit.
 */
export function deriveAvOffsetSeries(report: StreamerOriginAnalysisReport): MediaAvOffsetSeries[] {
  const videos = groupEntries(report.entries.filter((entry) => entry.type === "VIDEO"));
  const audios = groupEntries(report.entries.filter((entry) => entry.type === "AUDIO"));
  const series: MediaAvOffsetSeries[] = [];

  for (const video of videos) {
    for (const audio of audios) {
      const audioBySegment = new Map(
        audio.entries.map((entry) => [originalSegmentIndex(entry), entry]),
      );
      const samples = video.entries.flatMap((videoEntry) => {
        const segmentIndex = originalSegmentIndex(videoEntry);
        const audioEntry = audioBySegment.get(segmentIndex);
        if (
          !audioEntry ||
          typeof videoEntry.firstPtsTime !== "number" ||
          typeof audioEntry.firstPtsTime !== "number"
        ) {
          return [];
        }
        return [{
          segmentIndex,
          videoFirstPtsSeconds: videoEntry.firstPtsTime,
          audioFirstPtsSeconds: audioEntry.firstPtsTime,
          offsetSeconds: roundSeconds(audioEntry.firstPtsTime - videoEntry.firstPtsTime),
        }];
      }).sort((left, right) => left.segmentIndex - right.segmentIndex);
      if (samples.length === 0) continue;

      const offsets = samples.map((sample) => sample.offsetSeconds);
      const adjacentChanges = offsets.slice(1).map((offset, index) => offset - offsets[index]!);
      const firstToLastChangeSeconds = offsets.length > 1 ? offsets[offsets.length - 1]! - offsets[0]! : undefined;
      const maxAdjacentChangeSeconds = adjacentChanges.length > 0
        ? Math.max(...adjacentChanges.map(Math.abs))
        : undefined;
      const medianOffsetSeconds = median(offsets);
      const offsetSpreadSeconds = Math.max(...offsets) - Math.min(...offsets);
      const id = `derived.av_offset.${series.length}`;

      series.push({
        id,
        videoLabel: video.label,
        audioLabel: audio.label,
        pattern: classifyPattern({
          offsets,
          medianOffsetSeconds,
          offsetSpreadSeconds,
          firstToLastChangeSeconds,
          maxAdjacentChangeSeconds,
        }),
        sampleCount: samples.length,
        medianOffsetSeconds,
        offsetSpreadSeconds,
        ...(firstToLastChangeSeconds === undefined ? {} : { firstToLastChangeSeconds }),
        ...(maxAdjacentChangeSeconds === undefined ? {} : { maxAdjacentChangeSeconds }),
        samples,
      });
    }
  }
  return series;
}

function groupEntries(entries: Entry[]): Array<{ label: string; entries: Entry[] }> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = [entry.kind, entry.mediaIndex, entry.type, entry.streamSelector ?? ""].join(":");
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].map((group) => ({
    label: group[0]?.label ?? "unknown",
    entries: group,
  }));
}

function originalSegmentIndex(entry: Entry): number {
  return entry.originalSegmentIndex ?? entry.segmentIndex;
}

function classifyPattern(params: {
  offsets: number[];
  medianOffsetSeconds: number;
  offsetSpreadSeconds: number;
  firstToLastChangeSeconds?: number;
  maxAdjacentChangeSeconds?: number;
}): MediaAvOffsetSeries["pattern"] {
  if (params.offsets.length < 2) return "insufficient";
  if (params.offsetSpreadSeconds <= STABLE_SPREAD_SECONDS) {
    return Math.abs(params.medianOffsetSeconds) >= MATERIAL_OFFSET_SECONDS
      ? "constant_offset"
      : Math.abs(params.medianOffsetSeconds) <= ALIGNED_OFFSET_SECONDS
        ? "aligned"
        : "variable";
  }
  if (
    typeof params.maxAdjacentChangeSeconds === "number" &&
    params.maxAdjacentChangeSeconds >= DISCONTINUITY_SECONDS &&
    !changesMonotonically(params.offsets)
  ) {
    return "discontinuity";
  }
  if (
    typeof params.firstToLastChangeSeconds === "number" &&
    Math.abs(params.firstToLastChangeSeconds) >= DRIFT_SECONDS &&
    changesMonotonically(params.offsets)
  ) {
    return "drift";
  }
  return "variable";
}

function changesMonotonically(values: number[]): boolean {
  const meaningful = values.slice(1)
    .map((value, index) => value - values[index]!)
    .filter((change) => Math.abs(change) > 0.020);
  return meaningful.length > 0 && (meaningful.every((change) => change > 0) || meaningful.every((change) => change < 0));
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function roundSeconds(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
