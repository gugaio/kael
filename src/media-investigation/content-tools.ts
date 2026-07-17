import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { StreamerCloneResult } from "@gugaio/vhs";
import { LocalProcessRunner, type ProcessRunner } from "../process/runner.js";
import type { MediaContentQaEvidence, MediaInvestigationActivity } from "./types.js";

type ToolCallbacks = {
  onActivity: (activity: MediaInvestigationActivity) => Promise<void>;
  onEvidence: (evidence: MediaContentQaEvidence) => Promise<void>;
};

type AnalysisWindow = {
  reason: string;
  startSeconds: number;
  durationSeconds?: number;
};

type FfmpegResult = {
  ok: boolean;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
};

type DetectedEvent = {
  startSeconds?: number;
  endSeconds?: number;
  durationSeconds?: number;
};

type HlsManifestSegment = {
  index: number;
  uri: string;
  previousTags: string[];
  hasDiscontinuityBefore: boolean;
};

type HlsManifestInspection = {
  playlist: string;
  mediaSequence: number;
  discontinuitySequence?: number;
  discontinuityCount: number;
  segments: HlsManifestSegment[];
};

export async function createMediaInvestigationTools(params: {
  origin: StreamerCloneResult;
  callbacks: ToolCallbacks;
  runner?: ProcessRunner;
  maxCalls?: number;
}): Promise<AgentTool[]> {
  const inputPath = await resolvePlaybackPath(params.origin);
  const runner = params.runner ?? new LocalProcessRunner();
  const maxCalls = Math.max(1, Math.min(12, params.maxCalls ?? 8));
  const cache = new Map<string, { text: string; details: unknown }>();
  let callCount = 0;
  const counters = new Map<MediaContentQaEvidence["kind"], number>();

  const execute = async (options: {
    tool: string;
    rawParams: unknown;
    kind: MediaContentQaEvidence["kind"];
    filterArgs: (args: Record<string, unknown>) => string[];
    parse: (stderr: string, offsetSeconds: number) => DetectedEvent[];
  }) => {
    const args = asRecord(options.rawParams);
    const window = parseWindow(args);
    const parameters = { ...args, startSeconds: window.startSeconds };
    const cacheKey = `${options.tool}:${JSON.stringify(parameters)}`;
    const cached = cache.get(cacheKey);
    if (cached) return { content: textResult(`cached=true\n${cached.text}`), details: cached.details };

    const activity: MediaInvestigationActivity = {
      id: randomUUID(),
      tool: options.tool,
      reason: window.reason,
      state: callCount >= maxCalls ? "blocked" : "running",
      parameters,
      startedAt: new Date().toISOString(),
      evidenceIds: [],
    };
    if (callCount >= maxCalls) {
      activity.completedAt = activity.startedAt;
      activity.durationMs = 0;
      activity.summary = `Tool budget exhausted (${maxCalls} calls)`;
      await params.callbacks.onActivity(activity);
      return { content: textResult(`ok=false\nblocked=true\nreason=${activity.summary}`), details: activity };
    }
    callCount += 1;
    await params.callbacks.onActivity(activity);

    try {
      const commandArgs = [
        "-hide_banner", "-nostdin", "-loglevel", "info",
        ...(window.startSeconds > 0 ? ["-ss", String(window.startSeconds)] : []),
        "-i", inputPath,
        ...(window.durationSeconds === undefined ? [] : ["-t", String(window.durationSeconds)]),
        ...options.filterArgs(args),
        "-f", "null", "-",
      ];
      const result = await runFfmpeg(runner, commandArgs, 45_000);
      const events = options.parse(result.stderr, window.startSeconds);
      const evidences = events.length > 0
        ? events.map((event) => createEvidence(options.kind, options.tool, parameters, event, counters))
        : [createEvidence(options.kind, options.tool, parameters, {}, counters, result.ok)];
      for (const evidence of evidences) await params.callbacks.onEvidence(evidence);

      activity.state = result.ok ? "completed" : "failed";
      activity.completedAt = new Date().toISOString();
      activity.durationMs = result.durationMs;
      activity.evidenceIds = evidences.map((evidence) => evidence.id);
      activity.summary = evidences.map((evidence) => evidence.summary).join(" | ");
      if (!result.ok) activity.error = result.timedOut ? "ffmpeg timed out" : `ffmpeg exited with ${String(result.exitCode)}`;
      await params.callbacks.onActivity(activity);
      const text = [
        `ok=${result.ok}`,
        `tool=${options.tool}`,
        `events=${events.length}`,
        ...evidences.map((evidence) => `evidenceId=${evidence.id} ${evidence.summary}`),
      ].join("\n");
      const details = { activity, evidences };
      cache.set(cacheKey, { text, details });
      return { content: textResult(text), details };
    } catch (error) {
      activity.state = "failed";
      activity.completedAt = new Date().toISOString();
      activity.durationMs = Date.parse(activity.completedAt) - Date.parse(activity.startedAt);
      activity.error = error instanceof Error ? error.message : String(error);
      activity.summary = `${options.tool} failed`;
      await params.callbacks.onActivity(activity);
      return { content: textResult(`ok=false\nerror=${activity.error}`), details: activity };
    }
  };

  const inspectManifest = async (rawParams: unknown) => {
    const args = asRecord(rawParams);
    const reason = parseReason(args.reason, "Verificar sinalizacao HLS no boundary suspeito");
    const requestedSegment = args.segmentIndex === undefined
      ? undefined
      : Math.floor(clampNumber(args.segmentIndex, 0, 1_000_000, 0));
    const parameters = { reason, ...(requestedSegment === undefined ? {} : { segmentIndex: requestedSegment }) };
    const tool = "media_manifest_inspect";
    const cacheKey = `${tool}:${JSON.stringify(parameters)}`;
    const cached = cache.get(cacheKey);
    if (cached) return { content: textResult(`cached=true\n${cached.text}`), details: cached.details };

    const activity: MediaInvestigationActivity = {
      id: randomUUID(),
      tool,
      reason,
      state: callCount >= maxCalls ? "blocked" : "running",
      parameters,
      startedAt: new Date().toISOString(),
      evidenceIds: [],
    };
    if (callCount >= maxCalls) {
      activity.completedAt = activity.startedAt;
      activity.durationMs = 0;
      activity.summary = `Tool budget exhausted (${maxCalls} calls)`;
      await params.callbacks.onActivity(activity);
      return { content: textResult(`ok=false\nblocked=true\nreason=${activity.summary}`), details: activity };
    }
    callCount += 1;
    await params.callbacks.onActivity(activity);

    try {
      const startedAt = Date.now();
      const manifests = await inspectHlsManifests(params.origin);
      const selected = requestedSegment === undefined
        ? manifests
        : manifests.filter((manifest) => requestedSegment < manifest.segments.length);
      const evidences = selected.map((manifest) => createManifestEvidence(
        manifest,
        requestedSegment,
        parameters,
        counters,
      ));
      for (const evidence of evidences) await params.callbacks.onEvidence(evidence);

      activity.state = "completed";
      activity.completedAt = new Date().toISOString();
      activity.durationMs = Date.now() - startedAt;
      activity.evidenceIds = evidences.map((evidence) => evidence.id);
      activity.summary = evidences.length > 0
        ? evidences.map((evidence) => evidence.summary).join(" | ")
        : requestedSegment === undefined
          ? "No HLS media playlist found in cloned origin"
          : `No cloned HLS media playlist contains segment ${requestedSegment}`;
      await params.callbacks.onActivity(activity);
      const text = [
        "ok=true",
        `tool=${tool}`,
        `playlists=${manifests.length}`,
        `evidences=${evidences.length}`,
        ...evidences.map((evidence) => `evidenceId=${evidence.id} ${evidence.summary}`),
      ].join("\n");
      const details = { activity, evidences };
      cache.set(cacheKey, { text, details });
      return { content: textResult(text), details };
    } catch (error) {
      activity.state = "failed";
      activity.completedAt = new Date().toISOString();
      activity.durationMs = Date.parse(activity.completedAt) - Date.parse(activity.startedAt);
      activity.error = error instanceof Error ? error.message : String(error);
      activity.summary = `${tool} failed`;
      await params.callbacks.onActivity(activity);
      return { content: textResult(`ok=false\nerror=${activity.error}`), details: activity };
    }
  };

  return [
    ...(params.origin.protocol === "dash" ? [] : [{
      name: "media_manifest_inspect",
      label: "HLS Manifest Inspection",
      description: "Le os manifests HLS do clone e verifica, de forma estruturada, se EXT-X-DISCONTINUITY existe imediatamente antes de um segmento. Use quando houver reset de PTS, troca de source/ad, codec, sample rate, init segment ou suspeita de sinalizacao de boundary.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Hipotese de sinalizacao HLS que esta chamada pretende confirmar ou rejeitar." },
          segmentIndex: { type: "number", description: "Indice zero-based do segmento no boundary suspeito. Se omitido, retorna um overview das playlists." },
        },
        required: ["reason"],
        additionalProperties: false,
      } as unknown as AgentTool["parameters"],
      execute: async (_id: string, raw: unknown) => inspectManifest(raw),
    } as AgentTool]),
    {
      name: "media_freeze_detect",
      label: "Video Freeze Detection",
      description: "Decodifica video e detecta intervalos de frames visualmente congelados. Use para travadas, imagem parada ou suspeita de frames duplicados.",
      parameters: analysisParameters({
        minDurationSeconds: { type: "number", description: "Freeze minimo; padrao 0.5s." },
        noiseDb: { type: "number", description: "Tolerancia freezedetect em dB; padrao -50." },
      }),
      execute: async (_id, raw) => execute({
        tool: "media_freeze_detect",
        rawParams: raw,
        kind: "freeze",
        filterArgs: (args) => ["-map", "0:v:0", "-vf", `freezedetect=n=${clampNumber(args.noiseDb, -100, 0, -50)}dB:d=${clampNumber(args.minDurationSeconds, 0.1, 10, 0.5)}`, "-an"],
        parse: parseFreezeEvents,
      }),
    },
    {
      name: "media_black_detect",
      label: "Black Frame Detection",
      description: "Decodifica video e detecta intervalos pretos. Use para tela preta ou perda visual com timestamps validos.",
      parameters: analysisParameters({
        minDurationSeconds: { type: "number", description: "Intervalo preto minimo; padrao 0.5s." },
        pixelThreshold: { type: "number", description: "Threshold de pixel entre 0 e 1; padrao 0.10." },
      }),
      execute: async (_id, raw) => execute({
        tool: "media_black_detect",
        rawParams: raw,
        kind: "black",
        filterArgs: (args) => ["-map", "0:v:0", "-vf", `blackdetect=d=${clampNumber(args.minDurationSeconds, 0.1, 10, 0.5)}:pix_th=${clampNumber(args.pixelThreshold, 0, 1, 0.1)}`, "-an"],
        parse: parseBlackEvents,
      }),
    },
    {
      name: "media_silence_detect",
      label: "Audio Silence Detection",
      description: "Decodifica audio e detecta intervalos de silencio. Use para audio mudo, cortes ou suspeita de dropout perceptual.",
      parameters: analysisParameters({
        minDurationSeconds: { type: "number", description: "Silencio minimo; padrao 0.5s." },
        noiseDb: { type: "number", description: "Threshold de silencio em dB; padrao -50." },
      }),
      execute: async (_id, raw) => execute({
        tool: "media_silence_detect",
        rawParams: raw,
        kind: "silence",
        filterArgs: (args) => ["-map", "0:a:0", "-af", `silencedetect=n=${clampNumber(args.noiseDb, -100, 0, -50)}dB:d=${clampNumber(args.minDurationSeconds, 0.1, 10, 0.5)}`, "-vn"],
        parse: parseSilenceEvents,
      }),
    },
    {
      name: "media_decode_validate",
      label: "Media Decode Validation",
      description: "Decodifica audio e video sem gerar arquivo para encontrar corrupcao ou falhas que probe estrutural pode nao revelar.",
      parameters: analysisParameters({}),
      execute: async (_id, raw) => execute({
        tool: "media_decode_validate",
        rawParams: raw,
        kind: "decode",
        filterArgs: () => ["-map", "0:v?", "-map", "0:a?"],
        parse: () => [],
      }),
    },
  ];
}

function analysisParameters(extra: Record<string, unknown>): AgentTool["parameters"] {
  return {
    type: "object",
    properties: {
      reason: { type: "string", description: "Hipotese que esta chamada pretende confirmar ou rejeitar." },
      startSeconds: { type: "number", description: "Inicio opcional da janela; padrao 0." },
      durationSeconds: { type: "number", description: "Duracao opcional, limitada a 120s." },
      ...extra,
    },
    required: ["reason"],
    additionalProperties: false,
  } as unknown as AgentTool["parameters"];
}

async function resolvePlaybackPath(origin: StreamerCloneResult): Promise<string> {
  const playbackPath = (origin as StreamerCloneResult & { playbackPath?: string }).playbackPath
    ?? (origin.protocol === "dash" ? "/index.mpd" : "/index.m3u8");
  const root = path.resolve(origin.rootDir);
  const resolved = path.resolve(root, `.${playbackPath.startsWith("/") ? playbackPath : `/${playbackPath}`}`);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("playback path escapes origin root");
  await fs.access(resolved);
  return resolved;
}

function parseWindow(args: Record<string, unknown>): AnalysisWindow {
  const reason = parseReason(args.reason, "Confirmar hipotese de content QA");
  const startSeconds = clampNumber(args.startSeconds, 0, 86_400, 0);
  const durationSeconds = args.durationSeconds === undefined ? undefined : clampNumber(args.durationSeconds, 0.25, 120, 30);
  return { reason, startSeconds, ...(durationSeconds === undefined ? {} : { durationSeconds }) };
}

function parseReason(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function inspectHlsManifests(origin: StreamerCloneResult): Promise<HlsManifestInspection[]> {
  const root = path.resolve(origin.rootDir);
  const manifestPaths = await listManifestFiles(root);
  const inspections: HlsManifestInspection[] = [];
  for (const manifestPath of manifestPaths) {
    const text = await fs.readFile(manifestPath, "utf-8");
    const parsed = parseHlsMediaManifest(text, path.relative(root, manifestPath));
    if (parsed.segments.length > 0) inspections.push(parsed);
  }
  return inspections;
}

async function listManifestFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0 && files.length < 100) {
    const current = pending.shift()!;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const resolved = path.resolve(current, entry.name);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) continue;
      if (entry.isDirectory()) pending.push(resolved);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".m3u8")) files.push(resolved);
      if (files.length >= 100) break;
    }
  }
  return files.sort();
}

function parseHlsMediaManifest(text: string, playlist: string): HlsManifestInspection {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const mediaSequence = numberAfterPrefix(lines, "#EXT-X-MEDIA-SEQUENCE:") ?? 0;
  const discontinuitySequence = numberAfterPrefix(lines, "#EXT-X-DISCONTINUITY-SEQUENCE:");
  const segments: HlsManifestSegment[] = [];
  let pendingTags: string[] = [];
  let awaitingSegmentUri = false;
  for (const line of lines) {
    if (line.startsWith("#")) {
      if (isSegmentBoundaryTag(line)) pendingTags.push(line);
      if (line.startsWith("#EXTINF:")) awaitingSegmentUri = true;
      continue;
    }
    if (!awaitingSegmentUri) continue;
    segments.push({
      index: segments.length,
      uri: line,
      previousTags: [...pendingTags],
      hasDiscontinuityBefore: pendingTags.includes("#EXT-X-DISCONTINUITY"),
    });
    pendingTags = [];
    awaitingSegmentUri = false;
  }
  return {
    playlist,
    mediaSequence,
    ...(discontinuitySequence === undefined ? {} : { discontinuitySequence }),
    discontinuityCount: segments.filter((segment) => segment.hasDiscontinuityBefore).length,
    segments,
  };
}

function numberAfterPrefix(lines: string[], prefix: string): number | undefined {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  if (!line) return undefined;
  const value = Number(line.slice(prefix.length));
  return Number.isFinite(value) ? value : undefined;
}

function isSegmentBoundaryTag(line: string): boolean {
  if (line === "#EXT-X-DISCONTINUITY" || line === "#EXT-X-GAP") return true;
  return ["#EXTINF:", "#EXT-X-MAP:", "#EXT-X-KEY:", "#EXT-X-BYTERANGE:", "#EXT-X-PROGRAM-DATE-TIME:"]
    .some((prefix) => line.startsWith(prefix));
}

function createManifestEvidence(
  manifest: HlsManifestInspection,
  requestedSegment: number | undefined,
  parameters: Record<string, unknown>,
  counters: Map<MediaContentQaEvidence["kind"], number>,
): MediaContentQaEvidence {
  const index = counters.get("manifest") ?? 0;
  counters.set("manifest", index + 1);
  const segment = requestedSegment === undefined ? undefined : manifest.segments[requestedSegment];
  const id = `manifest.${segment ? "boundary" : "playlist"}.${index}`;
  const summary = segment
    ? [
        `HLS manifest boundary: playlist=${manifest.playlist}`,
        `segment=${segment.index}`,
        `uri=${segment.uri}`,
        `EXT-X-DISCONTINUITY before=${segment.hasDiscontinuityBefore}`,
        `mediaSequence=${manifest.mediaSequence}`,
      ].join("; ")
    : [
        `HLS manifest overview: playlist=${manifest.playlist}`,
        `segments=${manifest.segments.length}`,
        `discontinuities=${manifest.discontinuityCount}`,
        `mediaSequence=${manifest.mediaSequence}`,
      ].join("; ");
  return {
    id,
    kind: "manifest",
    summary,
    tool: "media_manifest_inspect",
    parameters,
    playlist: manifest.playlist,
    mediaSequence: manifest.mediaSequence,
    ...(manifest.discontinuitySequence === undefined ? {} : { discontinuitySequence: manifest.discontinuitySequence }),
    segmentCount: manifest.segments.length,
    discontinuityCount: manifest.discontinuityCount,
    ...(segment ? {
      segmentIndex: segment.index,
      segmentUri: segment.uri,
      hasDiscontinuityBefore: segment.hasDiscontinuityBefore,
      previousTags: segment.previousTags,
    } : {}),
  };
}

async function runFfmpeg(runner: ProcessRunner, args: string[], timeoutMs: number): Promise<FfmpegResult> {
  const startedAt = Date.now();
  const child = runner.spawn("ffmpeg", args).process;
  child.stdin.end();
  let stderr = "";
  let settled = false;
  let timedOut = false;
  const append = (current: string, chunk: unknown) => `${current}${String(chunk)}`.slice(-250_000);
  child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
  return new Promise((resolve) => {
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: exitCode === 0 && !timedOut, stderr, exitCode, timedOut, durationMs: Date.now() - startedAt });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      finish(null);
    }, timeoutMs);
    timeout.unref();
    child.on("error", () => finish(null));
    child.on("close", finish);
  });
}

function parseFreezeEvents(stderr: string, offsetSeconds: number): DetectedEvent[] {
  const starts = matches(stderr, /freeze_start:\s*(-?\d+(?:\.\d+)?)/g);
  const durations = matches(stderr, /freeze_duration:\s*(\d+(?:\.\d+)?)/g);
  const ends = matches(stderr, /freeze_end:\s*(-?\d+(?:\.\d+)?)/g);
  const events = starts.map((start, index) => ({
    startSeconds: start + offsetSeconds,
    ...(ends[index] === undefined ? {} : { endSeconds: ends[index]! + offsetSeconds }),
    ...(durations[index] === undefined ? {} : { durationSeconds: durations[index] }),
  }));
  return mergeAdjacent(events, 0.100);
}

function parseBlackEvents(stderr: string, offsetSeconds: number): DetectedEvent[] {
  const regex = /black_start:(-?\d+(?:\.\d+)?)\s+black_end:(-?\d+(?:\.\d+)?)\s+black_duration:(\d+(?:\.\d+)?)/g;
  return [...stderr.matchAll(regex)].map((match) => ({
    startSeconds: Number(match[1]) + offsetSeconds,
    endSeconds: Number(match[2]) + offsetSeconds,
    durationSeconds: Number(match[3]),
  }));
}

function parseSilenceEvents(stderr: string, offsetSeconds: number): DetectedEvent[] {
  const starts = matches(stderr, /silence_start:\s*(-?\d+(?:\.\d+)?)/g);
  const ends = matches(stderr, /silence_end:\s*(-?\d+(?:\.\d+)?)/g);
  const durations = matches(stderr, /silence_duration:\s*(\d+(?:\.\d+)?)/g);
  return starts.map((start, index) => ({
    startSeconds: start + offsetSeconds,
    ...(ends[index] === undefined ? {} : { endSeconds: ends[index]! + offsetSeconds }),
    ...(durations[index] === undefined ? {} : { durationSeconds: durations[index] }),
  }));
}

function mergeAdjacent(events: DetectedEvent[], maxGapSeconds: number): DetectedEvent[] {
  const merged: DetectedEvent[] = [];
  for (const event of events) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      typeof previous.endSeconds === "number" &&
      typeof event.startSeconds === "number" &&
      event.startSeconds - previous.endSeconds <= maxGapSeconds
    ) {
      previous.endSeconds = event.endSeconds ?? previous.endSeconds;
      if (typeof previous.startSeconds === "number" && typeof previous.endSeconds === "number") {
        previous.durationSeconds = previous.endSeconds - previous.startSeconds;
      }
    } else {
      merged.push({ ...event });
    }
  }
  return merged;
}

function createEvidence(
  kind: MediaContentQaEvidence["kind"],
  tool: string,
  parameters: Record<string, unknown>,
  event: DetectedEvent,
  counters: Map<MediaContentQaEvidence["kind"], number>,
  clean = false,
): MediaContentQaEvidence {
  const index = counters.get(kind) ?? 0;
  counters.set(kind, index + 1);
  const id = `content.${kind}.${index}`;
  const label = kind === "decode" ? "decode validation" : `${kind} detection`;
  const summary = typeof event.startSeconds === "number"
    ? `${label}: ${formatSeconds(event.startSeconds)} to ${formatSeconds(event.endSeconds)}; duration=${formatSeconds(event.durationSeconds)}`
    : `${label}: ${clean ? "no events detected" : "analysis failed or returned no event"}`;
  return { id, kind, summary, ...event, tool, parameters };
}

function matches(text: string, regex: RegExp): number[] {
  return [...text.matchAll(regex)].map((match) => Number(match[1])).filter(Number.isFinite);
}

function formatSeconds(value: number | undefined): string {
  return value === undefined ? "unknown" : `${value.toFixed(3)}s`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textResult(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}
