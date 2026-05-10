import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoInspectToolService } from "./inspect-service.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VideoInspectToolService", () => {
  it("captura atributos de EXT-X-MEDIA audio/subtitles e vinculos em variants", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          [
            "#EXTM3U",
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-aacl-128",LANGUAGE="pt",NAME="Portuguese",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="audio-pt.m3u8"',
            '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="textstream",LANGUAGE="pt",NAME="Portuguese (caption)",AUTOSELECT=YES,CHARACTERISTICS="public.accessibility.transcribes-spoken-dialog",URI="subs-pt.m3u8"',
            '#EXT-X-STREAM-INF:BANDWIDTH=793000,CODECS="mp4a.40.2,avc1.4D401E",RESOLUTION=640x360,FRAME-RATE=23.976,AUDIO="audio-aacl-128",SUBTITLES="textstream",CLOSED-CAPTIONS=NONE',
            "video-360.m3u8",
          ].join("\n"),
        ),
    );

    const result = await new VideoInspectToolService().inspectHls({
      url: "https://example.com/master.m3u8",
    });

    expect(result.renditions[0]).toMatchObject({
      type: "AUDIO",
      groupId: "audio-aacl-128",
      language: "pt",
      name: "Portuguese",
      default: true,
      autoselect: true,
      channels: "2",
      uri: "audio-pt.m3u8",
      url: "https://example.com/audio-pt.m3u8",
    });
    expect(result.renditions[1]).toMatchObject({
      type: "SUBTITLES",
      groupId: "textstream",
      language: "pt",
      name: "Portuguese (caption)",
      autoselect: true,
      characteristics: "public.accessibility.transcribes-spoken-dialog",
      uri: "subs-pt.m3u8",
      url: "https://example.com/subs-pt.m3u8",
    });
    expect(result.variants[0]).toMatchObject({
      audioGroupId: "audio-aacl-128",
      subtitlesGroupId: "textstream",
      closedCaptions: "NONE",
    });
  });

  it("captura EXT-X-MAP em media playlists fMP4", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          [
            "#EXTM3U",
            "#EXT-X-VERSION:7",
            "#EXT-X-TARGETDURATION:4",
            '#EXT-X-MAP:URI="init.mp4"',
            "#EXTINF:4.000,",
            "seg-0.m4s",
            "#EXTINF:4.000,",
            "seg-1.m4s",
            "#EXT-X-ENDLIST",
          ].join("\n"),
        ),
    );

    const result = await new VideoInspectToolService().inspectHls({
      url: "https://example.com/video/index.m3u8",
      maxSegments: 2,
    });

    expect(result.playlistType).toBe("media");
    expect(result.map).toEqual({
      uri: "init.mp4",
      url: "https://example.com/video/init.mp4",
      byteRange: undefined,
    });
    expect(result.segments.map((segment) => segment.map?.url)).toEqual([
      "https://example.com/video/init.mp4",
      "https://example.com/video/init.mp4",
    ]);
  });
});
