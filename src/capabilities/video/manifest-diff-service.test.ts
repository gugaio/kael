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
            variantsAudited: 0,
            variantsWithErrors: 0,
            targetDuration: 6,
          },
          issues: [{ code: "single_variant_ladder", severity: "warning", summary: "warning antiga", evidence: [] }],
          variantAudits: [],
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
            variantsAudited: 0,
            variantsWithErrors: 1,
            targetDuration: 8,
          },
          issues: [{ code: "variant_fetch_failures", severity: "error", summary: "falha nova", evidence: [] }],
          variantAudits: [],
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
    expect(result.summary).toContain("issue");
  });
});
