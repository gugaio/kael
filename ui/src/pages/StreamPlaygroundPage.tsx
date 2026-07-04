import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Clappr from "@clappr/player";
import HlsjsPlayback from "@clappr/hlsjs-playback";
import { Panel } from "../components/Panel";
import { getStream } from "../lib/api";
import { formatDate } from "../lib/format";

type HlsLogEntry = {
  id: number;
  at: string;
  event: string;
  level: "info" | "warning" | "error";
  details: string;
  fragmentTiming?: FragmentTiming;
  requestError?: RequestErrorTiming;
};

type HlsLoggerLevel = "trace" | "debug" | "log" | "info" | "warn" | "error";
type HlsLogger = Record<HlsLoggerLevel, (message?: unknown, ...optionalParams: unknown[]) => void>;

const HLS_DEBUG_EVENTS = [
  "hlsMediaAttaching",
  "hlsMediaAttached",
  "hlsMediaDetaching",
  "hlsMediaDetached",
  "hlsManifestLoading",
  "hlsManifestLoaded",
  "hlsManifestParsed",
  "hlsLevelSwitching",
  "hlsLevelSwitched",
  "hlsLevelLoading",
  "hlsLevelLoaded",
  "hlsLevelUpdated",
  "hlsLevelPtsUpdated",
  "hlsAudioTrackLoading",
  "hlsAudioTrackLoaded",
  "hlsSubtitleTrackLoading",
  "hlsSubtitleTrackLoaded",
  "hlsFragLoading",
  "hlsFragLoaded",
  "hlsFragParsed",
  "hlsFragBuffered",
  "hlsFragChanged",
  "hlsInitPtsFound",
  "hlsBufferCreated",
  "hlsBufferAppending",
  "hlsBufferAppended",
  "hlsBufferEos",
  "hlsBufferFlushing",
  "hlsBufferFlushed",
  "hlsFpsDrop",
  "hlsFpsDropLevelCapping",
  "hlsError",
];

type DiagnosticStatus = "ok" | "warning" | "error" | "idle";

type DiagnosticCard = {
  label: string;
  value: string;
  caption: string;
  status: DiagnosticStatus;
};

type DiagnosticFinding = {
  id: string;
  title: string;
  detail: string;
  status: Exclude<DiagnosticStatus, "idle">;
};

type RequestErrorDiagnostic = {
  id: string;
  at: string;
  category: "manifest" | "chunk" | "level" | "other";
  httpCode?: string;
  httpText?: string;
  details?: string;
  url?: string;
  fatal: boolean;
};

type FragmentDiagnostic = {
  key: string;
  sn: string;
  trackType: "video" | "audio" | "subtitle" | "unknown";
  duration?: string;
  start?: string;
  fragStartPts?: string;
  fragEndPts?: string;
  esStartPts?: string;
  esEndPts?: string;
  esStartDts?: string;
  esEndDts?: string;
  ptsDeltaFromPrevious?: number;
  avDeltaFromVideo?: number;
  url?: string;
  loaded: boolean;
  buffered: boolean;
  changed: boolean;
  error: boolean;
};

type FragmentTiming = {
  sn?: string;
  trackType?: FragmentDiagnostic["trackType"];
  url?: string;
  duration?: string;
  start?: string;
  fragStartPts?: string;
  fragEndPts?: string;
  elementaryStreams?: Partial<Record<"audio" | "video" | "audiovideo", ElementaryStreamTiming>>;
};

type RequestErrorTiming = Omit<RequestErrorDiagnostic, "id" | "at">;

type ElementaryStreamTiming = {
  startPts?: string;
  endPts?: string;
  startDts?: string;
  endDts?: string;
};

type PlaybackDiagnostics = {
  cards: DiagnosticCard[];
  findings: DiagnosticFinding[];
  requestErrors: RequestErrorDiagnostic[];
  fragments: FragmentDiagnostic[];
  fragmentGroups: Array<{
    label: string;
    trackType: FragmentDiagnostic["trackType"];
    fragments: FragmentDiagnostic[];
  }>;
};

function formatHlsEventData(data: unknown): {
  level: HlsLogEntry["level"];
  details: string;
  fragmentTiming?: FragmentTiming;
  requestError?: RequestErrorTiming;
} {
  if (!data || typeof data !== "object") {
    return { level: "info", details: data == null ? "" : String(data) };
  }

  const record = data as Record<string, unknown>;
  const details: string[] = [];
  const level = record.fatal === true ? "error" : record.type === "networkError" ? "warning" : "info";
  let fragmentTiming: FragmentTiming | undefined;
  const requestError = readRequestError(record);

  appendValue(details, "url", record.url);
  appendValue(details, "type", record.type);
  appendValue(details, "details", record.details);
  appendValue(details, "fatal", record.fatal);
  appendValue(details, "level", record.level);
  appendValue(details, "levelName", record.levelName);

  const frag = record.frag;
  if (frag && typeof frag === "object") {
    const fragRecord = frag as Record<string, unknown>;
    const trackType = inferFragmentTrackType(eventNameFromRecord(record), fragRecord);
    fragmentTiming = {
      sn: formatOptionalValue(fragRecord.sn),
      trackType,
      url: formatOptionalValue(fragRecord.url),
      duration: formatOptionalValue(fragRecord.duration),
      start: formatOptionalValue(fragRecord.start),
      fragStartPts: formatOptionalValue(fragRecord.startPTS),
      fragEndPts: formatOptionalValue(fragRecord.endPTS),
      elementaryStreams: readElementaryStreams(fragRecord.elementaryStreams),
    };
    appendValue(details, "sn", fragRecord.sn);
    appendValue(details, "fragUrl", fragRecord.url);
    appendValue(details, "duration", fragRecord.duration);
  }

  const response = record.response;
  if (response && typeof response === "object") {
    const responseRecord = response as Record<string, unknown>;
    appendValue(details, "code", responseRecord.code);
    appendValue(details, "text", responseRecord.text);
  }

  const stats = record.stats;
  if (stats && typeof stats === "object") {
    const statsRecord = stats as Record<string, unknown>;
    appendValue(details, "loaded", statsRecord.loaded);
    appendValue(details, "total", statsRecord.total);
  }

  return { level, details: details.length > 0 ? details.join(" | ") : compactJson(record), fragmentTiming, requestError };
}

function appendValue(details: string[], label: string, value: unknown): void {
  const formatted = formatOptionalValue(value);
  if (!formatted) {
    return;
  }
  details.push(`${label}=${formatted}`);
}

function formatOptionalValue(value: unknown): string | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  return typeof value === "number" && !Number.isInteger(value) ? value.toFixed(3) : String(value);
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (nestedValue instanceof Event || nestedValue instanceof HTMLElement) {
        return undefined;
      }
      return nestedValue;
    }).slice(0, 400);
  } catch {
    return "[unserializable]";
  }
}

function eventNameFromRecord(record: Record<string, unknown>): string {
  return String(record.event ?? record.type ?? "");
}

function inferFragmentTrackType(
  eventName: string,
  fragRecord: Record<string, unknown>,
): FragmentDiagnostic["trackType"] {
  const rawType = String(fragRecord.type ?? fragRecord.relurl ?? fragRecord.url ?? eventName).toLowerCase();
  if (rawType.includes("audio")) return "audio";
  if (rawType.includes("subtitle") || rawType.includes("text")) return "subtitle";
  if (rawType.includes("main") || rawType.includes("video")) return "video";
  return "unknown";
}

function readElementaryStreams(value: unknown): FragmentTiming["elementaryStreams"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const streams = value as Record<string, unknown>;
  const result: FragmentTiming["elementaryStreams"] = {};
  for (const streamType of ["audio", "video", "audiovideo"] as const) {
    const stream = streams[streamType];
    if (!stream || typeof stream !== "object") {
      continue;
    }
    const streamRecord = stream as Record<string, unknown>;
    result[streamType] = {
      startPts: formatOptionalValue(streamRecord.startPTS),
      endPts: formatOptionalValue(streamRecord.endPTS),
      startDts: formatOptionalValue(streamRecord.startDTS),
      endDts: formatOptionalValue(streamRecord.endDTS),
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function readRequestError(record: Record<string, unknown>): RequestErrorTiming | undefined {
  if (record.type !== "networkError" && record.fatal !== true) {
    return undefined;
  }
  const details = formatOptionalValue(record.details);
  const category = classifyRequestError(details, formatOptionalValue(record.url));
  const response = record.response && typeof record.response === "object"
    ? record.response as Record<string, unknown>
    : undefined;
  const httpCode = formatOptionalValue(response?.code);
  const httpText = formatOptionalValue(response?.text);
  const url = formatOptionalValue(response?.url) ?? formatOptionalValue(record.url);
  if (!details && !httpCode && !url) {
    return undefined;
  }
  return {
    category,
    httpCode,
    httpText,
    details,
    url,
    fatal: record.fatal === true,
  };
}

function classifyRequestError(details?: string, url?: string): RequestErrorDiagnostic["category"] {
  const value = `${details ?? ""} ${url ?? ""}`.toLowerCase();
  if (value.includes("manifest")) return "manifest";
  if (value.includes("level")) return "level";
  if (value.includes("frag") || value.includes("chunk") || value.includes("segment") || value.includes(".ts") || value.includes(".m4s")) {
    return "chunk";
  }
  return "other";
}

function formatLoggerArgs(args: unknown[]): string {
  return args.map(formatLoggerValue).join(" ");
}

function formatLoggerValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return String(value);
  }
  return compactJson(value);
}

function createHlsLogger(onHlsLog: (entry: Omit<HlsLogEntry, "id" | "at">) => void): HlsLogger {
  const emit = (loggerLevel: HlsLoggerLevel, args: unknown[]): void => {
    onHlsLog({
      event: `hls.js ${loggerLevel}`,
      level: loggerLevel === "error" ? "error" : loggerLevel === "warn" ? "warning" : "info",
      details: formatLoggerArgs(args),
    });
  };

  return {
    trace: (message?: unknown, ...optionalParams: unknown[]) => emit("trace", [message, ...optionalParams]),
    debug: (message?: unknown, ...optionalParams: unknown[]) => emit("debug", [message, ...optionalParams]),
    log: (message?: unknown, ...optionalParams: unknown[]) => emit("log", [message, ...optionalParams]),
    info: (message?: unknown, ...optionalParams: unknown[]) => emit("info", [message, ...optionalParams]),
    warn: (message?: unknown, ...optionalParams: unknown[]) => emit("warn", [message, ...optionalParams]),
    error: (message?: unknown, ...optionalParams: unknown[]) => emit("error", [message, ...optionalParams]),
  };
}

function buildPlaybackDiagnostics(logs: HlsLogEntry[]): PlaybackDiagnostics {
  const chronologicalLogs = [...logs].reverse();
  const fragments = new Map<string, FragmentDiagnostic>();
  const findings: DiagnosticFinding[] = [];
  const requestErrors: RequestErrorDiagnostic[] = [];
  let manifestLoads = 0;
  let manifestErrors = 0;
  let chunkErrors = 0;
  let bufferedFragments = 0;
  let changedFragments = 0;
  let eosSeen = false;
  let stallSignals = 0;
  let discontinuitySignals = 0;
  let timelineActivitySignals = 0;
  let timelineIssueSignals = 0;
  let lipsyncSignals = 0;
  let lastFatalError: HlsLogEntry | undefined;

  for (const entry of chronologicalLogs) {
    const event = entry.event.toLowerCase();
    const detail = entry.details.toLowerCase();
    const combined = `${event} ${detail}`;

    if (entry.event === "hlsManifestLoaded" || entry.event === "hlsManifestParsed") {
      manifestLoads += 1;
    }
    if (entry.event === "hlsError" && (detail.includes("manifest") || detail.includes("level"))) {
      manifestErrors += 1;
    }
    if (entry.event === "hlsError" && (detail.includes("frag") || detail.includes("chunk") || detail.includes("segment"))) {
      chunkErrors += 1;
    }
    if (entry.level === "error") {
      lastFatalError = entry;
    }
    if (entry.requestError) {
      requestErrors.push({
        ...entry.requestError,
        id: String(entry.id),
        at: entry.at,
      });
    }
    if (combined.includes("buffer_stalled_error") || combined.includes("stall") || combined.includes("waiting for buffer")) {
      stallSignals += 1;
    }
    const hasTimelineActivity =
      combined.includes("pts") ||
      combined.includes("dts") ||
      combined.includes("drift") ||
      combined.includes("timestamp") ||
      combined.includes(" cc [");
    const hasTimelineIssue =
      combined.includes("discontinuity") ||
      combined.includes("gap") ||
      combined.includes("hole") ||
      combined.includes("overlap") ||
      combined.includes("invalid") ||
      combined.includes("negative") ||
      combined.includes("non-monotonic") ||
      combined.includes("out of order") ||
      combined.includes("append error") ||
      combined.includes("buffer append error") ||
      combined.includes("drift too") ||
      combined.includes("drift exceeded");

    if (combined.includes("discontinuity")) {
      discontinuitySignals += 1;
    }
    if (hasTimelineActivity) {
      timelineActivitySignals += 1;
    }
    if (hasTimelineActivity && hasTimelineIssue) {
      timelineIssueSignals += 1;
    }
    if (combined.includes("lipsync") || combined.includes("lip sync") || combined.includes("audio/video")) {
      lipsyncSignals += 1;
    }
    if (
      combined.includes("endofstream") ||
      combined.includes("media source ended") ||
      combined.includes("buffer reached eos") ||
      entry.event === "hlsBufferEos"
    ) {
      eosSeen = true;
    }

    const sn = entry.fragmentTiming?.sn ?? readDetailValue(entry.details, "sn");
    if (sn) {
      const fragmentStreams = expandFragmentTimings(entry, sn);
      for (const fragmentStream of fragmentStreams) {
        const current = fragments.get(fragmentStream.key) ?? {
          ...fragmentStream,
          loaded: false,
          buffered: false,
          changed: false,
          error: false,
        };
        current.duration = current.duration ?? fragmentStream.duration;
        current.start = current.start ?? fragmentStream.start;
        current.fragStartPts = current.fragStartPts ?? fragmentStream.fragStartPts;
        current.fragEndPts = current.fragEndPts ?? fragmentStream.fragEndPts;
        current.esStartPts = current.esStartPts ?? fragmentStream.esStartPts;
        current.esEndPts = current.esEndPts ?? fragmentStream.esEndPts;
        current.esStartDts = current.esStartDts ?? fragmentStream.esStartDts;
        current.esEndDts = current.esEndDts ?? fragmentStream.esEndDts;
        current.url = current.url ?? fragmentStream.url;
        current.loaded = current.loaded || entry.event === "hlsFragLoaded";
        current.buffered = current.buffered || entry.event === "hlsFragBuffered";
        current.changed = current.changed || entry.event === "hlsFragChanged";
        current.error = current.error || entry.event === "hlsError";
        fragments.set(fragmentStream.key, current);
      }
    }

    const responseCode = Number(readDetailValue(entry.details, "code"));
    if (Number.isFinite(responseCode) && responseCode >= 400) {
      findings.push({
        id: `${entry.id}-http`,
        title: `HTTP ${responseCode}`,
        detail: entry.details,
        status: "error",
      });
    }
  }

  bufferedFragments = [...fragments.values()].filter((fragment) => fragment.buffered).length;
  changedFragments = [...fragments.values()].filter((fragment) => fragment.changed).length;

  if (manifestErrors > 0) {
    findings.push({
      id: "manifest-errors",
      title: "Manifest load/parsing errors",
      detail: `${manifestErrors} manifest or level error signal(s) found.`,
      status: "error",
    });
  }
  if (chunkErrors > 0) {
    findings.push({
      id: "chunk-errors",
      title: "Chunk download errors",
      detail: `${chunkErrors} fragment/chunk error signal(s) found.`,
      status: "error",
    });
  }
  if (stallSignals > 0) {
    findings.push({
      id: "buffer-stalls",
      title: "Buffer pressure",
      detail: `${stallSignals} stall or buffer-wait signal(s) found.`,
      status: "warning",
    });
  }
  if (discontinuitySignals > 0) {
    findings.push({
      id: "discontinuities",
      title: "Discontinuity signals",
      detail: `${discontinuitySignals} continuity/discontinuity marker(s) found in events or logs.`,
      status: "warning",
    });
  }
  if (timelineIssueSignals > 0) {
    findings.push({
      id: "pts-dts",
      title: "Timeline/PTS-DTS issue",
      detail: `${timelineIssueSignals} timeline issue signal(s) found near timestamp, PTS, DTS or drift logs.`,
      status: "warning",
    });
  }
  if (lipsyncSignals > 0) {
    findings.push({
      id: "lipsync",
      title: "Audio/video sync signals",
      detail: `${lipsyncSignals} lipsync or audio/video sync signal(s) found.`,
      status: "warning",
    });
  }
  if (lastFatalError) {
    findings.push({
      id: "last-fatal",
      title: "Last fatal/error log",
      detail: lastFatalError.details || lastFatalError.event,
      status: "error",
    });
  }

  const cards: DiagnosticCard[] = [
    {
      label: "Manifest",
      value: manifestErrors > 0 ? `${manifestErrors} issue(s)` : manifestLoads > 0 ? "Loaded" : "Waiting",
      caption: manifestLoads > 0 ? `${manifestLoads} manifest event(s)` : "No manifest event yet",
      status: manifestErrors > 0 ? "error" : manifestLoads > 0 ? "ok" : "idle",
    },
    {
      label: "Chunks",
      value: chunkErrors > 0 ? `${chunkErrors} failed` : `${bufferedFragments} buffered`,
      caption: `${fragments.size} fragment(s) observed`,
      status: chunkErrors > 0 ? "error" : bufferedFragments > 0 ? "ok" : "idle",
    },
    {
      label: "Buffer",
      value: stallSignals > 0 ? `${stallSignals} stall(s)` : eosSeen ? "EOS" : "Active",
      caption: eosSeen ? "MediaSource reached end" : `${changedFragments} playback fragment change(s)`,
      status: stallSignals > 0 ? "warning" : "ok",
    },
    {
      label: "Timeline",
      value: timelineIssueSignals + discontinuitySignals > 0 ? `${timelineIssueSignals + discontinuitySignals} issue(s)` : "Normal",
      caption:
        timelineActivitySignals > 0
          ? `${timelineActivitySignals} timestamp/PTS/DTS activity log(s)`
          : "No timing activity yet",
      status: timelineIssueSignals + discontinuitySignals > 0 ? "warning" : "ok",
    },
    {
      label: "A/V Sync",
      value: lipsyncSignals > 0 ? `${lipsyncSignals} signal(s)` : "No signal",
      caption: "Explicit lipsync/audio-video hints",
      status: lipsyncSignals > 0 ? "warning" : "ok",
    },
  ];

  const sortedFragments = [...fragments.values()].sort(
    (a, b) => trackSortValue(a.trackType) - trackSortValue(b.trackType) || Number(a.sn) - Number(b.sn),
  );
  for (const trackType of ["video", "audio", "subtitle", "unknown"] as const) {
    const trackFragments = sortedFragments
      .filter((fragment) => fragment.trackType === trackType)
      .sort((a, b) => Number(a.sn) - Number(b.sn));
    for (let index = 1; index < trackFragments.length; index += 1) {
      const previousEndPts = Number(getComparableEndPts(trackFragments[index - 1]));
      const currentStartPts = Number(getComparableStartPts(trackFragments[index]));
      if (Number.isFinite(previousEndPts) && Number.isFinite(currentStartPts)) {
        trackFragments[index].ptsDeltaFromPrevious = currentStartPts - previousEndPts;
      }
    }
  }

  const videoBySn = new Map(
    sortedFragments
      .filter((fragment) => fragment.trackType === "video")
      .map((fragment) => [fragment.sn, fragment]),
  );
  for (const audioFragment of sortedFragments.filter((fragment) => fragment.trackType === "audio")) {
    const videoFragment = videoBySn.get(audioFragment.sn);
    const audioStartPts = Number(getComparableStartPts(audioFragment));
    const videoStartPts = Number(videoFragment ? getComparableStartPts(videoFragment) : undefined);
    if (Number.isFinite(audioStartPts) && Number.isFinite(videoStartPts)) {
      audioFragment.avDeltaFromVideo = audioStartPts - videoStartPts;
    }
  }

  const videoFragments = sortedFragments.filter((fragment) => fragment.trackType === "video").slice(-12);
  const audioFragments = sortedFragments.filter((fragment) => fragment.trackType === "audio").slice(-12);
  const otherFragments = sortedFragments
    .filter((fragment) => fragment.trackType !== "video" && fragment.trackType !== "audio")
    .slice(-12);
  const recentFragments = [...videoFragments, ...audioFragments, ...otherFragments];
  const fragmentGroups = [
    { label: "Video PTS", trackType: "video" as const, fragments: videoFragments },
    { label: "Audio PTS", trackType: "audio" as const, fragments: audioFragments },
    { label: "Other PTS", trackType: "unknown" as const, fragments: otherFragments },
  ].filter((group) => group.fragments.length > 0);

  return {
    cards,
    findings: findings.slice(-8).reverse(),
    requestErrors: requestErrors.slice(-20).reverse(),
    fragments: recentFragments,
    fragmentGroups,
  };
}

function readDetailValue(details: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedKey}=([^|]+)`).exec(details);
  return match?.[1]?.trim();
}

function expandFragmentTimings(
  entry: HlsLogEntry,
  sn: string,
): Array<Omit<FragmentDiagnostic, "loaded" | "buffered" | "changed" | "error">> {
  const timing = entry.fragmentTiming;
  const base = {
    sn,
    duration: timing?.duration ?? readDetailValue(entry.details, "duration"),
    start: timing?.start,
    fragStartPts: timing?.fragStartPts,
    fragEndPts: timing?.fragEndPts,
    url: timing?.url ?? readDetailValue(entry.details, "fragUrl"),
  };
  const streams = timing?.elementaryStreams;
  const expanded: Array<Omit<FragmentDiagnostic, "loaded" | "buffered" | "changed" | "error">> = [];

  if (streams?.video) {
    expanded.push(createFragmentDiagnosticBase(sn, "video", base, streams.video));
  }
  if (streams?.audio) {
    expanded.push(createFragmentDiagnosticBase(sn, "audio", base, streams.audio));
  }
  if (streams?.audiovideo) {
    expanded.push(createFragmentDiagnosticBase(sn, "video", base, streams.audiovideo));
  }

  if (expanded.length > 0) {
    return expanded;
  }

  const fallbackTrackType = timing?.trackType ?? "unknown";
  return [
    {
      key: `${fallbackTrackType}:${sn}`,
      trackType: fallbackTrackType,
      ...base,
    },
  ];
}

function createFragmentDiagnosticBase(
  sn: string,
  trackType: FragmentDiagnostic["trackType"],
  base: Pick<FragmentDiagnostic, "sn" | "duration" | "start" | "fragStartPts" | "fragEndPts" | "url">,
  stream: ElementaryStreamTiming,
): Omit<FragmentDiagnostic, "loaded" | "buffered" | "changed" | "error"> {
  return {
    ...base,
    key: `${trackType}:${sn}`,
    trackType,
    esStartPts: stream.startPts,
    esEndPts: stream.endPts,
    esStartDts: stream.startDts,
    esEndDts: stream.endDts,
  };
}

function diagnosticStatusClass(status: DiagnosticStatus): string {
  if (status === "error") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-kael-border bg-kael-panelSoft text-kael-muted";
}

function fragmentStatusClass(fragment: FragmentDiagnostic): string {
  if (fragment.error) return "border-rose-300 bg-rose-500";
  if (fragment.changed) return "border-blue-300 bg-blue-500";
  if (fragment.buffered) return "border-emerald-300 bg-emerald-500";
  if (fragment.loaded) return "border-amber-300 bg-amber-400";
  return "border-zinc-300 bg-zinc-300";
}

function trackSortValue(trackType: FragmentDiagnostic["trackType"]): number {
  if (trackType === "video") return 0;
  if (trackType === "audio") return 1;
  if (trackType === "subtitle") return 2;
  return 3;
}

function formatRange(start?: string, end?: string): string | undefined {
  if (start && end) return `${start} -> ${end}`;
  return start ?? end;
}

function getComparableStartPts(fragment: FragmentDiagnostic): string | undefined {
  return fragment.esStartPts ?? fragment.fragStartPts;
}

function getComparableEndPts(fragment: FragmentDiagnostic): string | undefined {
  return fragment.esEndPts ?? fragment.fragEndPts;
}

function formatPtsDelta(delta?: number): string {
  if (delta == null) return "prev n/a";
  const normalized = Math.abs(delta) < 0.001 ? 0 : delta;
  if (normalized === 0) return "prev +0.000s";
  return normalized > 0 ? `gap +${normalized.toFixed(3)}s` : `overlap ${normalized.toFixed(3)}s`;
}

function ptsDeltaClass(delta?: number): string {
  if (delta == null || Math.abs(delta) < 0.05) return "text-kael-muted";
  return delta > 0 ? "text-amber-700" : "text-rose-700";
}

function formatAvDelta(delta?: number): string {
  if (delta == null) return "A/V n/a";
  const normalized = Math.abs(delta) < 0.001 ? 0 : delta;
  if (normalized === 0) return "A/V +0.000s";
  return normalized > 0 ? `A/V audio +${normalized.toFixed(3)}s` : `A/V audio ${normalized.toFixed(3)}s`;
}

function formatLogsForClipboard(logs: HlsLogEntry[]): string {
  const rows = logs.map((entry) => [entry.at, entry.level, entry.event, entry.details || "-"].join("\t"));
  return ["Time\tLevel\tEvent\tDetails", ...rows].join("\n");
}

function ClapprHlsPlayer(props: {
  source: string;
  reloadKey: number;
  hlsDebug: boolean;
  onHlsLog: (entry: Omit<HlsLogEntry, "id" | "at">) => void;
}): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mountRef.current || !props.source.trim()) {
      return undefined;
    }

    const hlsLogger = props.hlsDebug ? createHlsLogger(props.onHlsLog) : false;
    if (props.hlsDebug) {
      props.onHlsLog({
        event: "hls.js debug enabled",
        level: "info",
        details: `rebuilding player for ${props.source.trim()}`,
      });
    }

    const player = new Clappr.Player({
      source: props.source.trim(),
      parent: mountRef.current,
      plugins: [HlsjsPlayback],
      width: "100%",
      height: "100%",
      autoPlay: false,
      mute: false,
      hlsPlayback: {
        preload: true,
        customListeners: props.hlsDebug
          ? HLS_DEBUG_EVENTS.map((eventName) => ({
              eventName,
              callback: (_event: unknown, data: unknown) => {
                const formatted = formatHlsEventData(data);
                props.onHlsLog({
                  event: eventName,
                  level: formatted.level,
                  details: formatted.details,
                  fragmentTiming: formatted.fragmentTiming,
                  requestError: formatted.requestError,
                });
              },
            }))
          : [],
      },
      playback: {
        hlsjsConfig: {
          debug: hlsLogger,
          enableWorker: true,
        },
      },
    });

    return () => {
      player.destroy();
    };
  }, [props.hlsDebug, props.onHlsLog, props.reloadKey, props.source]);

  return <div ref={mountRef} className="h-full min-h-[180px] w-full overflow-hidden rounded-2xl bg-black" />;
}

export function StreamPlaygroundPage(): JSX.Element {
  const params = useParams<{ originId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const originId = params.originId ?? "";
  const initialUrl = searchParams.get("url") ?? "";
  const [sourceUrl, setSourceUrl] = useState(initialUrl);
  const [activeSourceUrl, setActiveSourceUrl] = useState(initialUrl);
  const [reloadKey, setReloadKey] = useState(0);
  const [hlsDebug, setHlsDebug] = useState(false);
  const [hlsLogs, setHlsLogs] = useState<HlsLogEntry[]>([]);
  const [copyLogsStatus, setCopyLogsStatus] = useState<"idle" | "copied" | "failed">("idle");

  const stream = useQuery({
    queryKey: ["stream", originId],
    queryFn: () => getStream(originId),
    enabled: originId.length > 0,
  });

  const resolvedUrl = useMemo(() => {
    if (activeSourceUrl.trim()) {
      return activeSourceUrl.trim();
    }
    return stream.data?.servingUrl ?? "";
  }, [activeSourceUrl, stream.data?.servingUrl]);

  const diagnostics = useMemo(() => buildPlaybackDiagnostics(hlsLogs), [hlsLogs]);

  useEffect(() => {
    if (!sourceUrl && stream.data?.servingUrl) {
      setSourceUrl(stream.data.servingUrl);
      setActiveSourceUrl(stream.data.servingUrl);
    }
  }, [sourceUrl, stream.data?.servingUrl]);

  const loadSource = (): void => {
    const nextUrl = sourceUrl.trim();
    setActiveSourceUrl(nextUrl);
    setHlsLogs([]);
    setReloadKey((current) => current + 1);
    if (nextUrl) {
      setSearchParams({ url: nextUrl });
    }
  };

  const addHlsLog = useCallback((entry: Omit<HlsLogEntry, "id" | "at">): void => {
    setCopyLogsStatus("idle");
    setHlsLogs((current) => [
      {
        ...entry,
        id: Date.now() + Math.random(),
        at: new Date().toLocaleTimeString(),
      },
      ...current,
    ].slice(0, 300));
  }, []);

  const copyHlsLogs = async (): Promise<void> => {
    const text = formatLogsForClipboard(hlsLogs);
    try {
      await navigator.clipboard.writeText(text);
      setCopyLogsStatus("copied");
    } catch {
      setCopyLogsStatus("failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/streams" className="text-sm text-kael-accent underline">
            Back to streams
          </Link>
          <h3 className="mt-2 text-2xl font-semibold text-kael-text">Stream Playground</h3>
        </div>
        <label className="flex items-center gap-2 text-sm text-kael-muted">
          <input
            type="checkbox"
            checked={hlsDebug}
            onChange={(event) => {
              setHlsDebug(event.target.checked);
              setHlsLogs([]);
              setReloadKey((current) => current + 1);
            }}
            className="rounded border-kael-border"
          />
          hls.js debug
        </label>
      </div>

      <Panel title="Playback">
        <div className="space-y-3">
          <div className="flex flex-col gap-2 lg:flex-row">
            <input
              type="text"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="http://127.0.0.1:9000/index.m3u8"
              className="min-w-0 flex-1 rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm focus:border-kael-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={loadSource}
              disabled={!sourceUrl.trim()}
              className="rounded-xl border border-kael-accent bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              Load
            </button>
          </div>

          <div className="aspect-video min-h-[180px] w-full max-w-3xl overflow-hidden rounded-2xl border border-kael-border bg-black">
            {resolvedUrl ? (
              <ClapprHlsPlayer
                source={resolvedUrl}
                reloadKey={reloadKey}
                hlsDebug={hlsDebug}
                onHlsLog={addHlsLog}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-400">
                No playback URL available.
              </div>
            )}
          </div>
        </div>
      </Panel>

      {hlsDebug && (
        <Panel title="Playback Diagnostics">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {diagnostics.cards.map((card) => (
                <div
                  key={card.label}
                  className={[
                    "min-w-0 rounded-2xl border p-3",
                    diagnosticStatusClass(card.status),
                  ].join(" ")}
                >
                  <p className="text-xs font-medium uppercase tracking-[0.16em] opacity-80">{card.label}</p>
                  <p className="mt-2 truncate text-xl font-semibold">{card.value}</p>
                  <p className="mt-1 truncate text-xs opacity-75">{card.caption}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-kael-border bg-kael-panelSoft p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-kael-muted">Fragment Timeline</p>
                <div className="flex flex-wrap gap-2 text-[11px] text-kael-muted">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> loaded</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> buffered</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> playing</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> error</span>
                </div>
              </div>
              {diagnostics.fragmentGroups.length === 0 ? (
                <p className="mt-3 text-sm text-kael-muted">No fragment activity captured yet.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {diagnostics.fragmentGroups.map((group) => (
                    <div key={group.trackType} className="min-w-0">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-kael-muted">{group.label}</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6 xl:grid-cols-9">
                        {group.fragments.map((fragment) => (
                          <div
                            key={fragment.key}
                            className="min-w-0 rounded-xl border border-kael-border bg-white p-2"
                            title={fragment.url}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-semibold text-kael-text">
                                {fragment.trackType} sn {fragment.sn}
                              </span>
                              <span className={["h-2.5 w-2.5 shrink-0 rounded-full border", fragmentStatusClass(fragment)].join(" ")} />
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                              <div
                                className={[
                                  "h-full rounded-full",
                                  fragment.error
                                    ? "bg-rose-500"
                                    : fragment.changed
                                      ? "bg-blue-500"
                                      : fragment.buffered
                                        ? "bg-emerald-500"
                                        : "bg-amber-400",
                                ].join(" ")}
                                style={{ width: fragment.buffered || fragment.changed ? "100%" : fragment.loaded ? "62%" : "28%" }}
                              />
                            </div>
                            <div className="mt-1 space-y-0.5 text-[11px] text-kael-muted">
                              <p className="truncate">
                                {fragment.start ? `start ${fragment.start}s` : "start n/a"}
                                {fragment.duration ? ` | dur ${fragment.duration}s` : ""}
                              </p>
                              <p className="truncate font-mono text-kael-text">
                                frag PTS {formatRange(fragment.fragStartPts, fragment.fragEndPts) ?? "n/a"}
                              </p>
                              <p className="truncate font-mono text-kael-text">
                                ES PTS {formatRange(fragment.esStartPts, fragment.esEndPts) ?? "n/a"}
                              </p>
                              <p className={["truncate font-mono", ptsDeltaClass(fragment.ptsDeltaFromPrevious)].join(" ")}>
                                {formatPtsDelta(fragment.ptsDeltaFromPrevious)}
                              </p>
                              {fragment.trackType === "audio" && (
                                <p className={["truncate font-mono", ptsDeltaClass(fragment.avDeltaFromVideo)].join(" ")}>
                                  {formatAvDelta(fragment.avDeltaFromVideo)}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-kael-border bg-white p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-kael-muted">Request Errors</p>
                <div className="flex flex-wrap gap-2 text-[11px] text-kael-muted">
                  <span>total {diagnostics.requestErrors.length}</span>
                  <span>manifest {diagnostics.requestErrors.filter((error) => error.category === "manifest").length}</span>
                  <span>chunks {diagnostics.requestErrors.filter((error) => error.category === "chunk").length}</span>
                  <span>levels {diagnostics.requestErrors.filter((error) => error.category === "level").length}</span>
                </div>
              </div>
              {diagnostics.requestErrors.length === 0 ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  No manifest, playlist or chunk request errors captured.
                </div>
              ) : (
                <div className="mt-3 max-h-[220px] overflow-auto rounded-xl border border-kael-border">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="sticky top-0 bg-kael-panelSoft text-kael-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Time</th>
                        <th className="px-3 py-2 font-medium">Kind</th>
                        <th className="px-3 py-2 font-medium">HTTP</th>
                        <th className="px-3 py-2 font-medium">Details</th>
                        <th className="px-3 py-2 font-medium">URL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnostics.requestErrors.map((error) => (
                        <tr key={error.id} className="border-t border-kael-border">
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-kael-muted">{error.at}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-kael-text">
                            {error.category}{error.fatal ? " fatal" : ""}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-rose-700">
                            {error.httpCode ? `${error.httpCode}${error.httpText ? ` ${error.httpText}` : ""}` : "-"}
                          </td>
                          <td className="px-3 py-2 font-mono text-kael-text">{error.details ?? "-"}</td>
                          <td className="max-w-[420px] truncate px-3 py-2 font-mono text-kael-muted" title={error.url}>
                            {error.url ?? "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
              <div className="rounded-2xl border border-kael-border bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-kael-muted">Findings</p>
                {diagnostics.findings.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    No manifest, chunk, buffer, discontinuity, PTS/DTS or sync issue detected in captured logs.
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {diagnostics.findings.map((finding) => (
                      <div
                        key={finding.id}
                        className={[
                          "rounded-xl border px-3 py-2",
                          diagnosticStatusClass(finding.status),
                        ].join(" ")}
                      >
                        <p className="text-sm font-semibold">{finding.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs opacity-80">{finding.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-kael-border bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-kael-muted">Readout</p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-kael-muted">Raw lines</dt>
                    <dd className="font-mono text-kael-text">{hlsLogs.length}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-kael-muted">Fragments</dt>
                    <dd className="font-mono text-kael-text">{diagnostics.fragments.length}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-kael-muted">Issues</dt>
                    <dd className="font-mono text-kael-text">{diagnostics.findings.length}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {hlsDebug && (
        <Panel title="hls.js Logs">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-kael-muted">{hlsLogs.length} hls.js log lines and events</p>
              <div className="flex items-center gap-2">
                {copyLogsStatus !== "idle" && (
                  <span
                    className={[
                      "text-xs",
                      copyLogsStatus === "copied" ? "text-emerald-700" : "text-rose-700",
                    ].join(" ")}
                  >
                    {copyLogsStatus === "copied" ? "Copied" : "Copy failed"}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void copyHlsLogs()}
                  disabled={hlsLogs.length === 0}
                  className="rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-1.5 text-xs font-medium text-kael-muted hover:bg-white disabled:opacity-50"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCopyLogsStatus("idle");
                    setHlsLogs([]);
                  }}
                  className="rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-1.5 text-xs font-medium text-kael-muted hover:bg-white"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[320px] overflow-auto rounded-2xl border border-kael-border bg-zinc-950">
              {hlsLogs.length === 0 ? (
                <div className="px-4 py-6 text-sm text-zinc-400">
                  Waiting for hls.js debug output. Press play or reload the source.
                </div>
              ) : (
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="sticky top-0 bg-zinc-900 text-zinc-300">
                    <tr>
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Event</th>
                      <th className="px-3 py-2 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hlsLogs.map((entry) => (
                      <tr key={entry.id} className="border-t border-zinc-800">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-400">{entry.at}</td>
                        <td
                          className={[
                            "whitespace-nowrap px-3 py-2 font-mono",
                            entry.level === "error"
                              ? "text-rose-300"
                              : entry.level === "warning"
                                ? "text-amber-300"
                                : "text-sky-300",
                          ].join(" ")}
                        >
                          {entry.event}
                        </td>
                        <td className="px-3 py-2 font-mono text-zinc-200">{entry.details || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </Panel>
      )}

      <Panel title="Origin">
        {stream.isLoading && <p className="text-sm text-kael-muted">Loading...</p>}
        {stream.error instanceof Error && <p className="text-sm text-rose-700">{stream.error.message}</p>}
        {stream.data && (
          <div className="grid gap-3 text-sm text-kael-muted md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-kael-border bg-kael-panelSoft p-3">
              <p className="text-xs uppercase tracking-[0.18em]">Origin</p>
              <p className="mt-1 truncate font-medium text-kael-text">{stream.data.id}</p>
            </div>
            <div className="rounded-2xl border border-kael-border bg-kael-panelSoft p-3">
              <p className="text-xs uppercase tracking-[0.18em]">Protocol</p>
              <p className="mt-1 font-medium text-kael-text">{stream.data.protocol ?? "hls"}</p>
            </div>
            <div className="rounded-2xl border border-kael-border bg-kael-panelSoft p-3">
              <p className="text-xs uppercase tracking-[0.18em]">Segments</p>
              <p className="mt-1 font-medium text-kael-text">{stream.data.segmentCount}</p>
            </div>
            <div className="rounded-2xl border border-kael-border bg-kael-panelSoft p-3">
              <p className="text-xs uppercase tracking-[0.18em]">Cloned</p>
              <p className="mt-1 font-medium text-kael-text">{formatDate(stream.data.createdAt)}</p>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
