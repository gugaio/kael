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
    const progressTypes: string[] = [];
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
      onProgress: (event) => {
        progressTypes.push(event.type);
      },
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
    expect(progressTypes).toContain("start");
    expect(progressTypes).toContain("manifest_fetch");
    expect(progressTypes).toContain("variant_ready");
    expect(progressTypes.filter((type) => type === "segment_downloaded")).toHaveLength(3);
    expect(progressTypes.at(-1)).toBe("complete");

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

  it("faz retry de download de segmento antes de falhar o clone", async () => {
    const root = await makeTempRoot();
    let attempts = 0;
    const progressTypes: string[] = [];
    const service = new StreamerService(
      {
        inspectHls: async ({ url }) =>
          makeInspectResult({
            url,
            finalUrl: url,
            playlistType: "media",
            targetDuration: 4,
            segments: [
              { uri: "seg.ts", url: "https://cdn.example.com/seg.ts", duration: 4 },
            ],
          }),
      },
      root,
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("This operation was aborted");
        }
        return new Response(new Uint8Array([1, 2, 3]));
      },
    );
    await service.init();

    const result = await service.cloneHls({
      sessionKey: "test",
      url: "https://example.com/media.m3u8",
      durationSeconds: 4,
      originId: "retry-origin",
      segmentRetries: 1,
      segmentTimeoutMs: 1000,
      onProgress: (event) => {
        progressTypes.push(event.type);
      },
    });

    expect(attempts).toBe(2);
    expect(result.segmentCount).toBe(1);
    expect(progressTypes).toContain("segment_download_retry");
    expect(progressTypes).toContain("segment_downloaded");
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

  it("serve um clone all-variants como live sliding window", async () => {
    const root = await makeTempRoot();
    const service = new StreamerService(
      {
        inspectHls: async ({ url }) => {
          if (url === "https://example.com/master.m3u8") {
            return makeInspectResult({
              variants: [
                {
                  uri: "low.m3u8",
                  url: "https://example.com/low.m3u8",
                  bandwidth: 600_000,
                  resolution: "640x360",
                },
                {
                  uri: "high.m3u8",
                  url: "https://example.com/high.m3u8",
                  bandwidth: 1_800_000,
                  resolution: "1280x720",
                },
              ],
            });
          }

          const lane = url.includes("high") ? "high" : "low";
          return makeInspectResult({
            url,
            finalUrl: url,
            playlistType: "media",
            targetDuration: 4,
            segments: [
              { uri: "seg-0.ts", url: `https://cdn.example.com/${lane}/seg-0.ts`, duration: 4 },
              { uri: "seg-1.ts", url: `https://cdn.example.com/${lane}/seg-1.ts`, duration: 4 },
              { uri: "seg-2.ts", url: `https://cdn.example.com/${lane}/seg-2.ts`, duration: 4 },
            ],
          });
        },
      },
      root,
      async (input) => new Response(new TextEncoder().encode(String(input))),
    );
    await service.init();
    const result = await service.cloneHls({
      sessionKey: "test",
      url: "https://example.com/master.m3u8",
      durationSeconds: 10,
      originId: "live-origin",
      allVariants: true,
    });
    const handle = await service.serveLiveOrigin(result.id, {
      windowSize: 3,
      initialMediaSequence: 50,
    });

    try {
      const master = await fetch(handle.playbackUrl).then((response) => response.text());
      expect(master).toContain("/live/0/index.m3u8");
      expect(master).toContain("/live/1/index.m3u8");

      const mediaResponse = await fetch(`${handle.baseUrl}/live/0/index.m3u8`);
      const media = await mediaResponse.text();
      expect(mediaResponse.headers.get("access-control-allow-origin")).toBe("*");
      expect(media).toContain("#EXT-X-MEDIA-SEQUENCE:50");
      expect(media).not.toContain("#EXT-X-ENDLIST");
      expect(media.match(/#EXTINF:/g)).toHaveLength(3);

      const segmentPath = media
        .split("\n")
        .find((line) => line.startsWith("/live/0/segments/"));
      expect(segmentPath).toBeDefined();
      const segmentResponse = await fetch(`${handle.baseUrl}${segmentPath}`);
      const segmentBody = await segmentResponse.text();
      expect(segmentResponse.headers.get("content-type")).toContain("video/mp2t");
      expect(segmentBody).toContain("https://cdn.example.com/low/");
    } finally {
      await handle.close();
    }
  });

  it("serve clone legado sem variants como live", async () => {
    const root = await makeTempRoot();
    const originDir = path.join(root, "legacy-origin");
    await fs.mkdir(path.join(originDir, "segments"), { recursive: true });
    await fs.writeFile(path.join(originDir, "segments", "00000-a.ts"), new Uint8Array([1, 2, 3]));
    await fs.writeFile(path.join(originDir, "index.m3u8"), "#EXTM3U\n#EXT-X-ENDLIST\n", "utf-8");
    await fs.writeFile(
      path.join(originDir, "origin.json"),
      `${JSON.stringify({
        id: "legacy-origin",
        sessionKey: "test",
        sourceUrl: "https://example.com/master.m3u8",
        selectedUrl: "https://example.com/media.m3u8",
        finalUrl: "https://example.com/media.m3u8",
        rootDir: originDir,
        manifestPath: path.join(originDir, "index.m3u8"),
        playbackPath: "/index.m3u8",
        requestedDurationSeconds: 4,
        cumulativeDurationSeconds: 4,
        reachedTargetDuration: true,
        targetDuration: 4,
        segmentCount: 1,
        bytes: 3,
        selectedVariant: {
          uri: "media.m3u8",
          url: "https://example.com/media.m3u8",
          bandwidth: 1000,
        },
        createdAt: new Date().toISOString(),
        segments: [
          {
            originalIndex: 0,
            sourceUri: "a.ts",
            sourceUrl: "https://example.com/a.ts",
            localUri: "segments/00000-a.ts",
            duration: 4,
            bytes: 3,
          },
        ],
      })}\n`,
      "utf-8",
    );

    const service = new StreamerService(
      {
        inspectHls: async () => makeInspectResult(),
      },
      root,
      async () => new Response(new Uint8Array()),
    );
    await service.init();
    const handle = await service.serveLiveOrigin("legacy-origin", {
      windowSize: 1,
      initialMediaSequence: 7,
    });

    try {
      const media = await fetch(handle.playbackUrl).then((response) => response.text());
      expect(media).toContain("#EXT-X-MEDIA-SEQUENCE:7");
      const segmentPath = media
        .split("\n")
        .find((line) => line.startsWith("/live/0/segments/"));
      expect(segmentPath).toBeDefined();
      const segment = await fetch(`${handle.baseUrl}${segmentPath}`).then((response) => response.arrayBuffer());
      expect(new Uint8Array(segment)).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      await handle.close();
    }
  });
});
