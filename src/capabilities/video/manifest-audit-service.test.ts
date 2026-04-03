import { describe, expect, it } from "vitest";
import { VideoManifestAuditService } from "./manifest-audit-service.js";
import type { VideoHlsInspectResult } from "./inspect-service.js";

function createInspectResult(overrides: Partial<VideoHlsInspectResult> = {}): VideoHlsInspectResult {
  return {
    ok: true,
    url: "https://example.com/master.m3u8",
    finalUrl: "https://example.com/master.m3u8",
    playlistType: "master",
    variants: [
      {
        uri: "720p.m3u8",
        url: "https://example.com/720p.m3u8",
        bandwidth: 2_000_000,
        codecs: "avc1.4d401f,mp4a.40.2",
        resolution: "1280x720",
      },
      {
        uri: "360p.m3u8",
        url: "https://example.com/360p.m3u8",
        bandwidth: 800_000,
        codecs: "avc1.4d401e,mp4a.40.2",
        resolution: "640x360",
      },
    ],
    renditions: [],
    segments: [],
    errors: [],
    ...overrides,
  };
}

describe("VideoManifestAuditService", () => {
  it("marca master playlist limpa quando nao encontra sinais fortes de erro", async () => {
    const service = new VideoManifestAuditService({
      inspectHls: async () => createInspectResult(),
    });

    const result = await service.auditHlsManifest({
      sessionKey: "s1",
      url: "https://example.com/master.m3u8",
    });

    expect(result.ok).toBe(true);
    expect(result.playlistType).toBe("master");
    expect(result.issues).toHaveLength(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("detecta falhas estruturais em master playlist", async () => {
    const service = new VideoManifestAuditService({
      inspectHls: async () =>
        createInspectResult({
          variants: [
            {
              uri: "broken.m3u8",
              url: "https://example.com/broken.m3u8",
              audioGroupId: "audio-main",
            },
          ],
        }),
    });

    const result = await service.auditHlsManifest({
      sessionKey: "s2",
      url: "https://example.com/master.m3u8",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("single_variant_ladder");
    expect(result.issues.map((issue) => issue.code)).toContain("variant_missing_bandwidth");
    expect(result.issues.map((issue) => issue.code)).toContain("variant_missing_codecs");
    expect(result.issues.map((issue) => issue.code)).toContain("missing_audio_group_rendition");
  });

  it("detecta problemas de segmentacao em media playlist", async () => {
    const service = new VideoManifestAuditService({
      inspectHls: async () =>
        createInspectResult({
          playlistType: "media",
          variants: [],
          segments: [
            { uri: "seg-1.ts", url: "https://example.com/seg-1.ts", duration: 6 },
            { uri: "seg-2.ts", url: "https://example.com/seg-2.ts", duration: 10.2 },
            { uri: "seg-3.ts", url: "https://example.com/seg-3.ts", duration: 5.8 },
          ],
          targetDuration: 6,
        }),
    });

    const result = await service.auditHlsManifest({
      sessionKey: "s3",
      url: "https://example.com/media.m3u8",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("segment_exceeds_target_duration");
    expect(result.issues.map((issue) => issue.code)).toContain("segment_duration_variation");
    expect(result.stats.maxSegmentDuration).toBeCloseTo(10.2);
  });
});
