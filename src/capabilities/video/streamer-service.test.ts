import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VideoHlsInspectResult } from "./inspect-service.js";
import { diagnoseStreamerClone } from "./streamer-diagnostics.js";
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
    expect(result.schemaVersion).toBe(2);
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

  it("preserva EXT-X-MAP baixando init segment local para fMP4", async () => {
    const root = await makeTempRoot();
    const fetchedUrls: string[] = [];
    const service = new StreamerService(
      {
        inspectHls: async ({ url }) =>
          makeInspectResult({
            url,
            finalUrl: url,
            playlistType: "media",
            variants: [],
            targetDuration: 4,
            mediaSequence: 30,
            map: {
              uri: "init.mp4",
              url: "https://cdn.example.com/init.mp4",
            },
            segments: [
              {
                uri: "seg-30.m4s",
                url: "https://cdn.example.com/seg-30.m4s",
                duration: 4,
                map: {
                  uri: "init.mp4",
                  url: "https://cdn.example.com/init.mp4",
                },
              },
              {
                uri: "seg-31.m4s",
                url: "https://cdn.example.com/seg-31.m4s",
                duration: 4,
                map: {
                  uri: "init.mp4",
                  url: "https://cdn.example.com/init.mp4",
                },
              },
            ],
          }),
      },
      root,
      async (input) => {
        fetchedUrls.push(String(input));
        if (String(input).endsWith("/init.mp4")) {
          return new Response(new Uint8Array([9, 9, 9, 9]));
        }
        return new Response(new Uint8Array([1, 2]));
      },
    );
    await service.init();

    const result = await service.cloneHls({
      sessionKey: "test",
      url: "https://example.com/media.m3u8",
      durationSeconds: 8,
      originId: "fmp4-origin",
    });

    expect(result.bytes).toBe(8);
    expect(result.variants[0].maps).toHaveLength(1);
    expect(result.variants[0].maps[0]).toMatchObject({
      sourceUrl: "https://cdn.example.com/init.mp4",
      localUri: "init/00000-init.mp4",
      bytes: 4,
    });
    expect(fetchedUrls).toEqual([
      "https://cdn.example.com/seg-30.m4s",
      "https://cdn.example.com/init.mp4",
      "https://cdn.example.com/seg-31.m4s",
    ]);

    const manifest = await fs.readFile(result.manifestPath, "utf-8");
    expect(manifest).toContain('#EXT-X-MAP:URI="init/00000-init.mp4"');
    expect(manifest.match(/#EXT-X-MAP/g)).toHaveLength(1);
    expect(manifest).toContain("segments/00000-seg-30.m4s");
    await expect(fs.stat(path.join(result.rootDir, "init", "00000-init.mp4"))).resolves.toBeTruthy();

    const handle = await service.serveLiveOrigin(result.id, {
      windowSize: 1,
      initialMediaSequence: 70,
    });
    try {
      const liveManifest = await fetch(handle.playbackUrl).then((response) => response.text());
      expect(liveManifest).toContain('#EXT-X-MAP:URI="/live/0/init/00000-init.mp4"');
      const initBytes = await fetch(`${handle.baseUrl}/live/0/init/00000-init.mp4`).then((response) =>
        response.arrayBuffer(),
      );
      expect(new Uint8Array(initBytes)).toEqual(new Uint8Array([9, 9, 9, 9]));
    } finally {
      await handle.close();
    }
  });

  it("clona renditions de audio separadas referenciadas pela master playlist", async () => {
    const root = await makeTempRoot();
    const fetchedUrls: string[] = [];
    const service = new StreamerService(
      {
        inspectHls: async ({ url }) => {
          if (url === "https://example.com/master.m3u8") {
            return makeInspectResult({
              variants: [
                {
                  uri: "video-720.m3u8",
                  url: "https://example.com/video-720.m3u8",
                  bandwidth: 2_000_000,
                  resolution: "1280x720",
                  frameRate: 23.976,
                  codecs: "mp4a.40.2,avc1.4D401F",
                  audioGroupId: "audio-aacl-128",
                  subtitlesGroupId: "textstream",
                  closedCaptions: "NONE",
                },
                {
                  uri: "video-720-ec3.m3u8",
                  url: "https://example.com/video-720-ec3.m3u8",
                  bandwidth: 2_400_000,
                  resolution: "1280x720",
                  frameRate: 23.976,
                  codecs: "ec-3,avc1.4D401F",
                  audioGroupId: "audio-ec-3-448",
                  subtitlesGroupId: "textstream",
                  closedCaptions: "NONE",
                },
              ],
              renditions: [
                {
                  type: "AUDIO",
                  groupId: "audio-aacl-128",
                  language: "pt",
                  name: "Portuguese",
                  default: true,
                  autoselect: true,
                  channels: "2",
                  uri: "audio-pt.m3u8",
                  url: "https://example.com/audio-pt.m3u8",
                },
                {
                  type: "AUDIO",
                  groupId: "audio-aacl-128",
                  language: "pt",
                  name: "Portuguese (description)",
                  autoselect: true,
                  characteristics: "public.accessibility.describes-video",
                  channels: "2",
                  uri: "audio-desc.m3u8",
                  url: "https://example.com/audio-desc.m3u8",
                },
                {
                  type: "SUBTITLES",
                  groupId: "textstream",
                  language: "pt",
                  name: "Portuguese (caption)",
                  uri: "subs-pt.m3u8",
                  url: "https://example.com/subs-pt.m3u8",
                },
              ],
            });
          }

          const isAudio = url.includes("audio-");
          return makeInspectResult({
            url,
            finalUrl: url,
            playlistType: "media",
            variants: [],
            targetDuration: 4,
            mediaSequence: isAudio ? 200 : 100,
            segments: [
              {
                uri: isAudio ? "audio-0.aac" : "video-0.ts",
                url: isAudio ? `${url}/audio-0.aac` : "https://cdn.example.com/video-0.ts",
                duration: 4,
              },
              {
                uri: isAudio ? "audio-1.aac" : "video-1.ts",
                url: isAudio ? `${url}/audio-1.aac` : "https://cdn.example.com/video-1.ts",
                duration: 4,
              },
            ],
          });
        },
      },
      root,
      async (input) => {
        fetchedUrls.push(String(input));
        return new Response(new TextEncoder().encode(String(input)));
      },
    );
    await service.init();

    const result = await service.cloneHls({
      sessionKey: "test",
      url: "https://example.com/master.m3u8",
      durationSeconds: 8,
      originId: "audio-renditions-origin",
    });

    expect(result.variantCount).toBe(1);
    expect(result.selectedVariant?.audioGroupId).toBe("audio-aacl-128");
    expect(result.selectedVariant?.codecs).toBe("mp4a.40.2,avc1.4D401F");
    expect(result.renditionCount).toBe(2);
    const diagnostic = diagnoseStreamerClone(result);
    expect(diagnostic.browserCompatibility).toBe("yes");
    expect(diagnostic.audioCodecs).toEqual(["mp4a.40.2"]);
    expect(result.renditions.map((rendition) => rendition.name)).toEqual([
      "Portuguese",
      "Portuguese (description)",
    ]);
    expect(result.renditions.every((rendition) => rendition.groupId === "audio-aacl-128")).toBe(true);
    expect(fetchedUrls).toEqual([
      "https://cdn.example.com/video-0.ts",
      "https://cdn.example.com/video-1.ts",
      "https://example.com/audio-pt.m3u8/audio-0.aac",
      "https://example.com/audio-pt.m3u8/audio-1.aac",
      "https://example.com/audio-desc.m3u8/audio-0.aac",
      "https://example.com/audio-desc.m3u8/audio-1.aac",
    ]);

    const master = await fs.readFile(result.manifestPath, "utf-8");
    expect(master).toContain('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-aacl-128",LANGUAGE="pt",NAME="Portuguese",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="audio/000-audio-aacl-128-Portuguese/index.m3u8"');
    expect(master).toContain('CHARACTERISTICS="public.accessibility.describes-video"');
    expect(master).toContain('AUDIO="audio-aacl-128"');
    expect(master).toContain("CLOSED-CAPTIONS=NONE");
    expect(master).not.toContain("SUBTITLES=");
    expect(master).not.toContain("textstream");
    expect(master).toContain("variants/000-1280x720/index.m3u8");

    const audioManifest = await fs.readFile(
      path.join(result.rootDir, "audio", "000-audio-aacl-128-Portuguese", "index.m3u8"),
      "utf-8",
    );
    expect(audioManifest).toContain("#EXT-X-MEDIA-SEQUENCE:200");
    expect(audioManifest).toContain("segments/00000-audio-0.aac");

    const handle = await service.serveLiveOrigin(result.id, {
      windowSize: 1,
      initialMediaSequence: 80,
    });
    try {
      const liveMaster = await fetch(handle.playbackUrl).then((response) => response.text());
      expect(liveMaster).toContain('URI="/live/audio/0/index.m3u8"');
      expect(liveMaster).toContain('AUDIO="audio-aacl-128"');

      const liveAudio = await fetch(`${handle.baseUrl}/live/audio/0/index.m3u8`).then((response) =>
        response.text(),
      );
      expect(liveAudio).toContain("#EXT-X-MEDIA-SEQUENCE:80");
      const audioSegmentPath = liveAudio
        .split("\n")
        .find((line) => line.startsWith("/live/audio/0/segments/"));
      expect(audioSegmentPath).toBeDefined();
      const audioSegment = await fetch(`${handle.baseUrl}${audioSegmentPath}`).then((response) => response.text());
      expect(audioSegment).toContain("https://example.com/audio-pt.m3u8/");
    } finally {
      await handle.close();
    }
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

  it("lista, inspeciona e remove origins clonados", async () => {
    const root = await makeTempRoot();
    const service = new StreamerService(
      {
        inspectHls: async ({ url }) =>
          makeInspectResult({
            url,
            finalUrl: url,
            playlistType: "media",
            targetDuration: 4,
            segments: [
              { uri: "seg-0.ts", url: "https://cdn.example.com/seg-0.ts", duration: 4 },
              { uri: "seg-1.ts", url: "https://cdn.example.com/seg-1.ts", duration: 4 },
            ],
          }),
      },
      root,
      async () => new Response(new Uint8Array([1, 2])),
    );
    await service.init();

    const result = await service.cloneHls({
      sessionKey: "test",
      url: "https://example.com/media.m3u8",
      durationSeconds: 8,
      originId: "managed-origin",
    });

    const origins = await service.listOrigins();
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({
      id: "managed-origin",
      schemaVersion: 2,
      segmentCount: 2,
      variantCount: 1,
      bytes: 4,
      allVariants: false,
    });

    const inspected = await service.inspectOrigin("managed-origin");
    expect(inspected.id).toBe("managed-origin");
    expect(inspected.rootDir).toBe(result.rootDir);
    expect(inspected.variants).toHaveLength(1);
    expect(inspected.variants[0].segments).toHaveLength(2);

    const removed = await service.removeOrigin("managed-origin");
    expect(removed).toEqual({
      id: "managed-origin",
      rootDir: result.rootDir,
      removed: true,
    });
    await expect(fs.stat(result.rootDir)).rejects.toThrow();
    await expect(service.listOrigins()).resolves.toEqual([]);
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

});
