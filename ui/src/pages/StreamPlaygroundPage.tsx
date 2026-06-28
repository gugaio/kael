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
};

type HlsLoggerLevel = "trace" | "debug" | "log" | "info" | "warn" | "error";
type HlsLogger = Record<HlsLoggerLevel, (message?: unknown, ...optionalParams: unknown[]) => void>;

const HLS_DEBUG_EVENTS = [
  "hlsMediaAttaching",
  "hlsMediaAttached",
  "hlsManifestLoading",
  "hlsManifestLoaded",
  "hlsManifestParsed",
  "hlsLevelLoading",
  "hlsLevelLoaded",
  "hlsLevelUpdated",
  "hlsFragLoading",
  "hlsFragLoaded",
  "hlsFragBuffered",
  "hlsFragChanged",
  "hlsError",
];

function formatHlsEventData(data: unknown): { level: HlsLogEntry["level"]; details: string } {
  if (!data || typeof data !== "object") {
    return { level: "info", details: data == null ? "" : String(data) };
  }

  const record = data as Record<string, unknown>;
  const details: string[] = [];
  const level = record.fatal === true ? "error" : record.type === "networkError" ? "warning" : "info";

  appendValue(details, "url", record.url);
  appendValue(details, "type", record.type);
  appendValue(details, "details", record.details);
  appendValue(details, "fatal", record.fatal);
  appendValue(details, "level", record.level);
  appendValue(details, "levelName", record.levelName);

  const frag = record.frag;
  if (frag && typeof frag === "object") {
    const fragRecord = frag as Record<string, unknown>;
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

  return { level, details: details.length > 0 ? details.join(" | ") : compactJson(record) };
}

function appendValue(details: string[], label: string, value: unknown): void {
  if (value == null || value === "") {
    return;
  }
  const formatted = typeof value === "number" && !Number.isInteger(value) ? value.toFixed(3) : String(value);
  details.push(`${label}=${formatted}`);
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
                props.onHlsLog({ event: eventName, level: formatted.level, details: formatted.details });
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
    setHlsLogs((current) => [
      {
        ...entry,
        id: Date.now() + Math.random(),
        at: new Date().toLocaleTimeString(),
      },
      ...current,
    ].slice(0, 300));
  }, []);

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
        <Panel title="hls.js Logs">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-kael-muted">{hlsLogs.length} hls.js log lines and events</p>
              <button
                type="button"
                onClick={() => setHlsLogs([])}
                className="rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-1.5 text-xs font-medium text-kael-muted hover:bg-white"
              >
                Clear
              </button>
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
