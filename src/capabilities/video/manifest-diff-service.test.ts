import { describe, expect, it } from "vitest";
import { VideoManifestDiffService } from "./manifest-diff-service.js";
import type { HlsManifestAuditInput, HlsManifestAuditReport } from "./types.js";

describe("VideoManifestDiffService", () => {
  it("compares two audits and surfaces added/removed issues", async () => {
    const reports = new Map<string, HlsManifestAuditReport>([
      [
        "https://left.example/master.m3u8",
        {
          ok: true,
          url: "https://left.example/master.m3u8",
          finalUrl: "https://left.example/master.m3u8",
          playlistType: "master",
          summary: "left",
          stats: {
            variants: 2,
            renditions: 1,
            segments: 0,
            variantsAudited: 1,
            variantsWithErrors: 0,
            targetDuration: 6,
          },
          issues: [{ code: "single_variant_ladder", severity: "warning", summary: "warning antiga", evidence: [] }],
          variantAudits: [
            {
              uri: "v1.m3u8",
              url: "https://left.example/v1.m3u8",
              finalUrl: "https://left.example/v1.m3u8",
              resolution: "1280x720",
              bandwidth: 2500000,
              codecs: "avc1.64001f,mp4a.40.2",
              playlistType: "media",
              summary: "left variant",
              ok: true,
              stats: { segments: 6, targetDuration: 6, averageSegmentDuration: 5.8 },
              issues: [],
            },
          ],
          aggregateIssues: [],
          recommendations: [],
        },
      ],
      [
        "https://right.example/master.m3u8",
        {
          ok: false,
          url: "https://right.example/master.m3u8",
          finalUrl: "https://right.example/master.m3u8",
          playlistType: "master",
          summary: "right",
          stats: {
            variants: 3,
            renditions: 1,
            segments: 0,
            variantsAudited: 2,
            variantsWithErrors: 1,
            targetDuration: 8,
          },
          issues: [{ code: "variant_fetch_failures", severity: "error", summary: "falha nova", evidence: [] }],
          variantAudits: [
            {
              uri: "v1.m3u8",
              url: "https://right.example/v1.m3u8",
              finalUrl: "https://right.example/v1.m3u8",
              resolution: "1280x720",
              bandwidth: 2500000,
              codecs: "avc1.64001f,mp4a.40.2",
              playlistType: "media",
              summary: "right variant",
              ok: false,
              stats: { segments: 6, targetDuration: 8, averageSegmentDuration: 7.7 },
              issues: [{ code: "target_duration_too_high", severity: "error", summary: "regressao na variant", evidence: [] }],
            },
            {
              uri: "v2.m3u8",
              url: "https://right.example/v2.m3u8",
              finalUrl: "https://right.example/v2.m3u8",
              resolution: "1920x1080",
              bandwidth: 4500000,
              codecs: "avc1.640028,mp4a.40.2",
              playlistType: "media",
              summary: "nova variant",
              ok: true,
              stats: { segments: 6, targetDuration: 8, averageSegmentDuration: 7.9 },
              issues: [],
            },
          ],
          aggregateIssues: [],
          recommendations: [],
        },
      ],
    ]);
    const service = new VideoManifestDiffService({
      auditHlsManifest: async (input: HlsManifestAuditInput) => {
        const found = reports.get(input.url);
        if (!found) {
          throw new Error(`unexpected url: ${input.url}`);
        }
        return found;
      },
    });

    const result = await service.diffHlsManifests({
      sessionKey: "s1",
      leftUrl: "https://left.example/master.m3u8",
      rightUrl: "https://right.example/master.m3u8",
    });

    expect(result.ok).toBe(false);
    expect(result.delta.variants).toBe(1);
    expect(result.delta.variantsWithErrors).toBe(1);
    expect(result.delta.targetDuration).toBe(2);
    expect(result.issueDiff.added.map((item) => item.code)).toEqual(["variant_fetch_failures"]);
    expect(result.issueDiff.removed.map((item) => item.code)).toEqual(["single_variant_ladder"]);
    expect(result.variantDiff.regressed).toHaveLength(1);
    expect(result.variantDiff.regressed[0]?.left?.uri).toBe("v1.m3u8");
    expect(result.variantDiff.added).toHaveLength(1);
    expect(result.variantDiff.added[0]?.right?.uri).toBe("v2.m3u8");
    expect(result.summary).toContain("issue");
  });
});
