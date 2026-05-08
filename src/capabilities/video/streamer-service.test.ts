import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VideoHlsInspectResult } from "./inspect-service.js";
import { StreamerService } from "./streamer-service.js";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kael-streamer-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function makeInspectResult(overrides: Partial<VideoHlsInspectResult> = {}): VideoHlsInspectResult {
  return {
    ok: true,
    url: "https://example.com/master.m3u8",
    finalUrl: "https://example.com/master.m3u8",
    playlistType: "master",
    variants: [],
    renditions: [],
    segments: [],
    discontinuityMarkers: [],
    errors: [],
    ...overrides,
  };
}

describe("StreamerService", () => {
  it("seleciona a variant de maior bandwidth e baixa segmentos ate cumulative >= alvo", async () => {
    const root = await makeTempRoot();
    const fetchedUrls: string[] = [];
    const service = new StreamerService(
      {
        inspectHls: async ({ url }) => {
          if (url === "https://example.com/master.m3u8") {
            return makeInspectResult({
              variants: [
                {
                  uri: "low.m3u8",
                  url: "https://example.com/low.m3u8",
                  bandwidth: 800_000,
                  resolution: "640x360",
                },
                {
                  uri: "high.m3u8",
                  url: "https://example.com/high.m3u8",
                  bandwidth: 2_500_000,
                  resolution: "1280x720",
                },
              ],
            });
          }

          return makeInspectResult({
            url,
            finalUrl: url,
            playlistType: "media",
            variants: [],
            targetDuration: 4,
            mediaSequence: 10,
            segments: [
              { uri: "seg-10.ts", url: "https://cdn.example.com/seg-10.ts", duration: 4 },
              { uri: "seg-11.ts", url: "https://cdn.example.com/seg-11.ts", duration: 4 },
              { uri: "seg-12.ts", url: "https://cdn.example.com/seg-12.ts", duration: 4 },
              { uri: "seg-13.ts", url: "https://cdn.example.com/seg-13.ts", duration: 4 },
            ],
          });
        },
      },
      root,
      async (input) => {
        fetchedUrls.push(String(input));
        return new Response(new Uint8Array([1, 2, 3]));
      },
    );
    await service.init();

    const result = await service.cloneHls({
      sessionKey: "test",
      url: "https://example.com/master.m3u8",
      durationSeconds: 10,
      originId: "fixture-origin",
    });

    expect(result.id).toBe("fixture-origin");
    expect(result.allVariants).toBe(false);
    expect(result.variantCount).toBe(1);
    expect(result.selectedUrl).toBe("https://example.com/high.m3u8");
    expect(result.selectedVariant?.resolution).toBe("1280x720");
    expect(result.segmentCount).toBe(3);
    expect(result.cumulativeDurationSeconds).toBe(12);
    expect(result.reachedTargetDuration).toBe(true);
    expect(fetchedUrls).toEqual([
      "https://cdn.example.com/seg-10.ts",
      "https://cdn.example.com/seg-11.ts",
      "https://cdn.example.com/seg-12.ts",
    ]);

    const manifest = await fs.readFile(result.manifestPath, "utf-8");
    expect(manifest).toContain("#EXT-X-MEDIA-SEQUENCE:10");
    expect(manifest).toContain("segments/00000-seg-10.ts");
    expect(manifest).toContain("#EXT-X-ENDLIST");
    await expect(fs.stat(path.join(result.rootDir, "segments", "00002-seg-12.ts"))).resolves.toBeTruthy();
  });

  it("clona todas as variants e gera uma master local quando allVariants esta ativo", async () => {
    const root = await makeTempRoot();
    const fetchedUrls: string[] = [];
    const service = new StreamerService(
      {
        inspectHls: async ({ url }) => {
          if (url === "https://example.com/master.m3u8") {
            return makeInspectResult({
              variants: [
                {
                  uri: "low/playlist.m3u8",
                  url: "https://example.com/low/playlist.m3u8",
                  bandwidth: 700_000,
                  resolution: "640x360",
                  codecs: "avc1.4d401e,mp4a.40.2",
                },
                {
                  uri: "high/playlist.m3u8",
                  url: "https://example.com/high/playlist.m3u8",
                  bandwidth: 2_000_000,
                  resolution: "1280x720",
                  codecs: "avc1.4d401f,mp4a.40.2",
                },
              ],
            });
          }

          const isHigh = url.includes("/high/");
          return makeInspectResult({
            url,
            finalUrl: url,
            playlistType: "media",
            variants: [],
            targetDuration: 5,
            mediaSequence: 20,
            segments: [
              {
                uri: "seg-20.ts",
                url: `https://cdn.example.com/${isHigh ? "high" : "low"}/seg-20.ts`,
                duration: 5,
              },
              {
                uri: "seg-21.ts",
                url: `https://cdn.example.com/${isHigh ? "high" : "low"}/seg-21.ts`,
                duration: 5,
              },
            ],
          });
        },
      },
      root,
      async (input) => {
        fetchedUrls.push(String(input));
        return new Response(new Uint8Array([1, 2]));
      },
    );
    await service.init();

    const result = await service.cloneHls({
      sessionKey: "test",
      url: "https://example.com/master.m3u8",
      durationSeconds: 8,
      originId: "all-variants-origin",
      allVariants: true,
    });

    expect(result.allVariants).toBe(true);
    expect(result.variantCount).toBe(2);
    expect(result.segmentCount).toBe(4);
    expect(result.cumulativeDurationSeconds).toBe(10);
    expect(result.bytes).toBe(8);
    expect(fetchedUrls).toEqual([
      "https://cdn.example.com/low/seg-20.ts",
      "https://cdn.example.com/low/seg-21.ts",
      "https://cdn.example.com/high/seg-20.ts",
      "https://cdn.example.com/high/seg-21.ts",
    ]);

    const master = await fs.readFile(result.manifestPath, "utf-8");
    expect(master).toContain("#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=640x360");
    expect(master).toContain("variants/000-640x360/index.m3u8");
    expect(master).toContain("variants/001-1280x720/index.m3u8");

    const lowManifest = await fs.readFile(path.join(result.rootDir, "variants", "000-640x360", "index.m3u8"), "utf-8");
    expect(lowManifest).toContain("#EXT-X-MEDIA-SEQUENCE:20");
    expect(lowManifest).toContain("segments/00000-seg-20.ts");
    await expect(
      fs.stat(path.join(result.rootDir, "variants", "001-1280x720", "segments", "00001-seg-21.ts")),
    ).resolves.toBeTruthy();
  });

  it("serve o origin local com CORS", async () => {
    const root = await makeTempRoot();
    const service = new StreamerService(
      {
        inspectHls: async ({ url }) =>
          makeInspectResult({
            url,
            finalUrl: url,
            playlistType: "media",
            targetDuration: 6,
            segments: [
              { uri: "seg.ts", url: "https://cdn.example.com/seg.ts", duration: 6 },
            ],
          }),
      },
      root,
      async () => new Response(new Uint8Array([9, 8, 7])),
    );
    await service.init();
    const result = await service.cloneHls({
      sessionKey: "test",
      url: "https://example.com/media.m3u8",
      durationSeconds: 6,
      originId: "served-origin",
    });
    const handle = await service.serveOrigin(result.id);

    try {
      const response = await fetch(handle.playbackUrl);
      const body = await response.text();
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(body).toContain("segments/00000-seg.ts");
    } finally {
      await handle.close();
    }
  });
});
