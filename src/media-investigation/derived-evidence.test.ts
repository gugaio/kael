import { describe, expect, it } from "vitest";
import type { StreamerOriginAnalysisReport } from "@gugaio/vhs";
import { deriveAvOffsetSeries } from "./derived-evidence.js";

describe("deriveAvOffsetSeries", () => {
  it("tc_001_audio_delayed classifica offset de audio constante proximo de 2s", () => {
    const report = reportWithOffsets([1.954667, 1.98, 1.981367]);

    const [series] = deriveAvOffsetSeries(report);

    expect(series).toMatchObject({
      pattern: "constant_offset",
      sampleCount: 3,
      medianOffsetSeconds: expect.closeTo(1.98, 5),
      offsetSpreadSeconds: expect.closeTo(0.0267, 3),
    });
    expect(series?.samples.map((sample) => sample.offsetSeconds)).toEqual([1.954667, 1.98, 1.981367]);
  });

  it("diferencia drift progressivo de offset constante", () => {
    const [series] = deriveAvOffsetSeries(reportWithOffsets([0.05, 0.3, 0.58, 0.9]));
    expect(series?.pattern).toBe("drift");
    expect(series?.firstToLastChangeSeconds).toBeCloseTo(0.85, 5);
  });
});

function reportWithOffsets(offsets: number[]): StreamerOriginAnalysisReport {
  const videoEntries = offsets.map((_, segmentIndex) => entry("VIDEO", segmentIndex, segmentIndex * 4));
  const audioEntries = offsets.map((offset, segmentIndex) => entry("AUDIO", segmentIndex, segmentIndex * 4 + offset));
  return {
    originId: "tc_001_audio_delayed",
    ok: true,
    sampledMediaPlaylists: 2,
    totalMediaPlaylists: 2,
    sampledSegments: offsets.length * 2,
    okSegments: offsets.length * 2,
    failedSegments: 0,
    media: [],
    avAlignment: { status: "warn", comparedPairs: offsets.length, notes: [] },
    issues: [],
    entries: [...videoEntries, ...audioEntries],
  };
}

function entry(type: "AUDIO" | "VIDEO", segmentIndex: number, firstPtsTime: number) {
  return {
    kind: type === "VIDEO" ? "variant" as const : "rendition" as const,
    mediaIndex: 0,
    segmentIndex,
    originalSegmentIndex: segmentIndex,
    type,
    label: type === "VIDEO" ? "video/main" : "audio/pt",
    localPath: `/tmp/${type.toLowerCase()}-${segmentIndex}`,
    streamCount: 1,
    firstPtsTime,
    ok: true,
    errors: [],
  };
}
