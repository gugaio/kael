import { spawnSync } from "node:child_process";
import { validateStreamUrl } from "./jobs/safety.js";

type HlsVariant = {
  uri: string;
  url: string;
  bandwidth?: number;
  averageBandwidth?: number;
  resolution?: string;
  frameRate?: number;
  codecs?: string;
  audioGroupId?: string;
  subtitlesGroupId?: string;
  closedCaptions?: string;
};

type HlsRendition = {
  type: string;
  groupId?: string;
  name?: string;
  language?: string;
  default?: boolean;
  autoselect?: boolean;
  forced?: boolean;
  channels?: string;
  characteristics?: string;
  uri?: string;
  url?: string;
};

type HlsMap = {
  uri: string;
  url: string;
  byteRange?: string;
};

type HlsSegment = {
  uri: string;
  url: string;
  duration?: number;
  title?: string;
  map?: HlsMap;
};

export type VideoHlsInspectResult = {
  ok: boolean;
  url: string;
  finalUrl: string;
  playlistType: "master" | "media" | "unknown";
  variants: HlsVariant[];
  renditions: HlsRendition[];
  segments: HlsSegment[];
  map?: HlsMap;
  targetDuration?: number;
  mediaSequence?: number;
  /** Valor declarado em #EXT-X-DISCONTINUITY-SEQUENCE (se presente). */
  discontinuitySequence?: number;
  /** Índices (0-based) no array de segmentos onde apareceu #EXT-X-DISCONTINUITY. */
  discontinuityMarkers: number[];
  errors: string[];
};

export type VideoProbeResult = {
  ok: boolean;
  input: string;
  timeoutMs: number;
  format?: unknown;
  streams?: unknown[];
  keyframes?: {
    streamSelector: string;
    count: number;
    timestamps: number[];
  };
  errors: string[];
};

function parseAttrList(attrText: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < attrText.length) {
    while (i < attrText.length && (attrText[i] === "," || attrText[i] === " ")) i += 1;
    let key = "";
    while (i < attrText.length && attrText[i] !== "=" && attrText[i] !== ",") {
      key += attrText[i];
      i += 1;
    }
    if (!key || i >= attrText.length || attrText[i] !== "=") {
      while (i < attrText.length && attrText[i] !== ",") i += 1;
      continue;
    }
    i += 1;
    let value = "";
    if (attrText[i] === "\"") {
      i += 1;
      while (i < attrText.length) {
        const ch = attrText[i];
        if (ch === "\"") {
          i += 1;
          break;
        }
        value += ch;
        i += 1;
      }
    } else {
      while (i < attrText.length && attrText[i] !== ",") {
        value += attrText[i];
        i += 1;
      }
    }
    out[key.trim().toUpperCase()] = value.trim();
  }
  return out;
}

function resolveUrl(base: string, candidate: string): string {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return candidate;
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<{ finalUrl: string; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "Kael/0.1 (+video-inspect)" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await res.text();
    return { finalUrl: res.url || url, text };
  } finally {
    clearTimeout(timer);
  }
}

export class VideoInspectToolService {
  constructor(
    private readonly cfg: {
      defaultFetchTimeoutMs: number;
      defaultProbeTimeoutMs: number;
      maxProbeTimeoutMs: number;
      maxKeyframes: number;
    } = {
      defaultFetchTimeoutMs: 15_000,
      defaultProbeTimeoutMs: 20_000,
      maxProbeTimeoutMs: 120_000,
      maxKeyframes: 200,
    },
  ) {}

  async inspectHls(params: {
    url: string;
    maxSegments?: number;
    timeoutMs?: number;
  }): Promise<VideoHlsInspectResult> {
    validateStreamUrl(params.url);
    const errors: string[] = [];
    const maxSegments = Math.max(0, Math.min(200, Math.floor(params.maxSegments ?? 20)));
    const timeoutMs = Math.max(1_000, Math.min(60_000, Math.floor(params.timeoutMs ?? this.cfg.defaultFetchTimeoutMs)));

    const fetched = await fetchText(params.url, timeoutMs);
    const lines = fetched.text.split(/\r?\n/).map((line) => line.trim());

    const variants: HlsVariant[] = [];
    const renditions: HlsRendition[] = [];
    const segments: HlsSegment[] = [];
    let playlistType: VideoHlsInspectResult["playlistType"] = "unknown";
    let targetDuration: number | undefined;
    let mediaSequence: number | undefined;
    let discontinuitySequence: number | undefined;
    let currentMap: HlsMap | undefined;
    const discontinuityMarkers: number[] = [];
    let nextSegmentHasDiscontinuity = false;
    let pendingVariantAttrs: Record<string, string> | null = null;
    let pendingSegment: { duration?: number; title?: string } | null = null;

    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      if (!line) continue;
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        playlistType = "master";
        pendingVariantAttrs = parseAttrList(line.slice("#EXT-X-STREAM-INF:".length));
        continue;
      }
      if (line.startsWith("#EXT-X-MEDIA:")) {
        playlistType = playlistType === "unknown" ? "master" : playlistType;
        const attrs = parseAttrList(line.slice("#EXT-X-MEDIA:".length));
        const uri = attrs.URI;
        renditions.push({
          type: attrs.TYPE ?? "",
          groupId: attrs["GROUP-ID"],
          name: attrs.NAME,
          language: attrs.LANGUAGE,
          default: attrs.DEFAULT?.toUpperCase() === "YES",
          autoselect: attrs.AUTOSELECT?.toUpperCase() === "YES",
          forced: attrs.FORCED?.toUpperCase() === "YES",
          channels: attrs.CHANNELS,
          characteristics: attrs.CHARACTERISTICS,
          uri,
          url: uri ? resolveUrl(fetched.finalUrl, uri) : undefined,
        });
        continue;
      }
      if (line.startsWith("#EXTINF:")) {
        playlistType = playlistType === "unknown" ? "media" : playlistType;
        const payload = line.slice("#EXTINF:".length);
        const [dur, ...titleParts] = payload.split(",");
        const duration = Number.parseFloat(dur);
        pendingSegment = {
          duration: Number.isFinite(duration) ? duration : undefined,
          title: titleParts.join(",").trim() || undefined,
        };
        continue;
      }
      if (line.startsWith("#EXT-X-TARGETDURATION:")) {
        const num = Number.parseInt(line.slice("#EXT-X-TARGETDURATION:".length), 10);
        targetDuration = Number.isFinite(num) ? num : undefined;
        continue;
      }
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        const num = Number.parseInt(line.slice("#EXT-X-MEDIA-SEQUENCE:".length), 10);
        mediaSequence = Number.isFinite(num) ? num : undefined;
        continue;
      }
      if (line.startsWith("#EXT-X-MAP:")) {
        playlistType = playlistType === "unknown" ? "media" : playlistType;
        const attrs = parseAttrList(line.slice("#EXT-X-MAP:".length));
        if (attrs.URI) {
          currentMap = {
            uri: attrs.URI,
            url: resolveUrl(fetched.finalUrl, attrs.URI),
            byteRange: attrs.BYTERANGE,
          };
        }
        continue;
      }
      if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) {
        const num = Number.parseInt(line.slice("#EXT-X-DISCONTINUITY-SEQUENCE:".length), 10);
        discontinuitySequence = Number.isFinite(num) ? num : undefined;
        continue;
      }
      if (line === "#EXT-X-DISCONTINUITY") {
        nextSegmentHasDiscontinuity = true;
        continue;
      }
      if (line.startsWith("#")) continue;

      if (pendingVariantAttrs) {
        variants.push({
          uri: line,
          url: resolveUrl(fetched.finalUrl, line),
          bandwidth: pendingVariantAttrs.BANDWIDTH ? Number.parseInt(pendingVariantAttrs.BANDWIDTH, 10) : undefined,
          averageBandwidth: pendingVariantAttrs["AVERAGE-BANDWIDTH"]
            ? Number.parseInt(pendingVariantAttrs["AVERAGE-BANDWIDTH"], 10)
            : undefined,
          resolution: pendingVariantAttrs.RESOLUTION,
          frameRate: pendingVariantAttrs["FRAME-RATE"]
            ? Number.parseFloat(pendingVariantAttrs["FRAME-RATE"])
            : undefined,
          codecs: pendingVariantAttrs.CODECS,
          audioGroupId: pendingVariantAttrs.AUDIO,
          subtitlesGroupId: pendingVariantAttrs.SUBTITLES,
          closedCaptions: pendingVariantAttrs["CLOSED-CAPTIONS"],
        });
        pendingVariantAttrs = null;
        continue;
      }

      if (segments.length < maxSegments) {
        if (nextSegmentHasDiscontinuity) {
          discontinuityMarkers.push(segments.length);
        }
        segments.push({
          uri: line,
          url: resolveUrl(fetched.finalUrl, line),
          duration: pendingSegment?.duration,
          title: pendingSegment?.title,
          map: currentMap,
        });
      }
      nextSegmentHasDiscontinuity = false;
      pendingSegment = null;
    }

    if (playlistType === "unknown") {
      errors.push("manifest did not contain recognized HLS tags");
    }

    return {
      ok: errors.length === 0,
      url: params.url,
      finalUrl: fetched.finalUrl,
      playlistType,
      variants,
      renditions,
      segments,
      map: segments.find((segment) => segment.map)?.map,
      targetDuration,
      mediaSequence,
      discontinuitySequence,
      discontinuityMarkers,
      errors,
    };
  }

  async probe(params: {
    input: string;
    timeoutMs?: number;
    keyframes?: boolean;
    maxKeyframes?: number;
    streamSelector?: string;
  }): Promise<VideoProbeResult> {
    const timeoutMs = Math.max(
      1_000,
      Math.min(this.cfg.maxProbeTimeoutMs, Math.floor(params.timeoutMs ?? this.cfg.defaultProbeTimeoutMs)),
    );
    const errors: string[] = [];

    const base = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", params.input],
      {
        encoding: "utf-8",
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      },
    );

    if (base.error) {
      throw base.error;
    }
    if (base.status !== 0) {
      return {
        ok: false,
        input: params.input,
        timeoutMs,
        errors: [base.stderr?.trim() || `ffprobe exited with ${String(base.status)}`],
      };
    }

    let parsedBase: { format?: unknown; streams?: unknown[] } = {};
    try {
      parsedBase = JSON.parse(base.stdout || "{}") as { format?: unknown; streams?: unknown[] };
    } catch {
      errors.push("failed to parse ffprobe JSON output");
    }

    let keyframePayload: VideoProbeResult["keyframes"];
    if (params.keyframes) {
      const streamSelector = (params.streamSelector || "v:0").trim() || "v:0";
      const maxKeyframes = Math.max(1, Math.min(this.cfg.maxKeyframes, Math.floor(params.maxKeyframes ?? 50)));
      const frames = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          streamSelector,
          "-skip_frame",
          "nokey",
          "-show_frames",
          "-show_entries",
          "frame=best_effort_timestamp_time,pkt_dts_time,pkt_pts_time,key_frame,pict_type",
          "-of",
          "json",
          params.input,
        ],
        {
          encoding: "utf-8",
          timeout: timeoutMs,
          maxBuffer: 32 * 1024 * 1024,
        },
      );
      if (frames.error) {
        throw frames.error;
      }
      if (frames.status !== 0) {
        errors.push(frames.stderr?.trim() || `ffprobe keyframes exited with ${String(frames.status)}`);
      } else {
        try {
          const payload = JSON.parse(frames.stdout || "{}") as { frames?: Array<Record<string, unknown>> };
          const timestamps: number[] = [];
          for (const frame of payload.frames ?? []) {
            const key = frame.key_frame;
            if (!(key === 1 || key === "1")) continue;
            const raw =
              frame.best_effort_timestamp_time ??
              frame.pkt_pts_time ??
              frame.pkt_dts_time;
            const value = typeof raw === "string" || typeof raw === "number"
              ? Number(raw)
              : Number.NaN;
            if (!Number.isFinite(value)) continue;
            timestamps.push(value);
            if (timestamps.length >= maxKeyframes) break;
          }
          keyframePayload = {
            streamSelector,
            count: timestamps.length,
            timestamps,
          };
        } catch {
          errors.push("failed to parse ffprobe keyframes JSON output");
        }
      }
    }

    return {
      ok: errors.length === 0,
      input: params.input,
      timeoutMs,
      format: parsedBase.format,
      streams: parsedBase.streams,
      keyframes: keyframePayload,
      errors,
    };
  }
}
