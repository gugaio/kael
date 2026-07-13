import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Panel } from "../components/Panel";
import {
  analyzeStream,
  getStream,
  type StreamAnalysisEntry,
  type StreamAnalysisReport,
  type StreamRendition,
  type StreamSegment,
  type StreamVariant,
} from "../lib/api";
import { formatDate } from "../lib/format";

type MediaGroup = {
  kind: "variant" | "rendition";
  index: number;
  type: "VIDEO" | "AUDIO" | "SUBTITLES" | "UNKNOWN";
  label: string;
  manifestPath: string;
  targetDuration: number;
  segmentCount: number;
  cumulativeDurationSeconds: number;
  bytes: number;
  segments: StreamSegment[];
};

type SelectedChunk = {
  group: MediaGroup;
  segment: StreamSegment;
  segmentIndex: number;
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatSeconds(value: number | undefined, digits = 3): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}s` : "-";
}

function formatSignedSeconds(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}s`;
}

function formatPtsDeltaUs(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${(value / 1_000_000).toFixed(3)}s`;
}

function variantLabel(variant: StreamVariant, index: number): string {
  const meta = variant.variant;
  return [
    `Variant ${index}`,
    meta?.resolution,
    meta?.bandwidth ? `${Math.round(meta.bandwidth / 1000)} kbps` : undefined,
    meta?.codecs,
  ].filter(Boolean).join(" | ");
}

function renditionLabel(rendition: StreamRendition, index: number): string {
  return [
    `${rendition.type.toUpperCase()} ${index}`,
    rendition.language,
    rendition.name,
    rendition.channels ? `${rendition.channels}ch` : undefined,
    rendition.codecs,
  ].filter(Boolean).join(" | ");
}

function normalizeRenditionType(type: string): MediaGroup["type"] {
  const normalized = type.toUpperCase();
  if (normalized === "AUDIO") return "AUDIO";
  if (normalized === "SUBTITLES") return "SUBTITLES";
  return "UNKNOWN";
}

function buildGroups(stream: Awaited<ReturnType<typeof getStream>> | undefined): MediaGroup[] {
  if (!stream) return [];
  return [
    ...(stream.variants ?? []).map((variant, index) => ({
      kind: "variant" as const,
      index,
      type: "VIDEO" as const,
      label: variantLabel(variant, index),
      manifestPath: variant.manifestPath,
      targetDuration: variant.targetDuration,
      segmentCount: variant.segmentCount,
      cumulativeDurationSeconds: variant.cumulativeDurationSeconds,
      bytes: variant.bytes,
      segments: variant.segments,
    })),
    ...(stream.renditions ?? []).map((rendition, index) => ({
      kind: "rendition" as const,
      index,
      type: normalizeRenditionType(rendition.type),
      label: renditionLabel(rendition, index),
      manifestPath: rendition.manifestPath,
      targetDuration: rendition.targetDuration,
      segmentCount: rendition.segmentCount,
      cumulativeDurationSeconds: rendition.cumulativeDurationSeconds,
      bytes: rendition.bytes,
      segments: rendition.segments,
    })),
  ];
}

function findAnalysisEntry(
  report: StreamAnalysisReport | undefined,
  selected: SelectedChunk | null,
): StreamAnalysisEntry[] {
  if (!report || !selected) return [];
  return report.entries.filter((entry) =>
    entry.kind === selected.group.kind &&
    entry.mediaIndex === selected.group.index &&
    entry.segmentIndex === selected.segmentIndex
  );
}

export function StreamDetailsPage(): JSX.Element {
  const { originId = "" } = useParams();
  const [selected, setSelected] = useState<SelectedChunk | null>(null);

  const stream = useQuery({
    queryKey: ["stream", originId],
    queryFn: () => getStream(originId),
    enabled: Boolean(originId),
  });

  const analyze = useMutation({
    mutationFn: (params?: Parameters<typeof analyzeStream>[1]) =>
      analyzeStream(originId, params ?? { full: true, timeoutMs: 15_000 }),
  });

  const groups = useMemo(() => buildGroups(stream.data), [stream.data]);
  const selectedAnalysis = findAnalysisEntry(analyze.data, selected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/streams" className="text-xs text-kael-accent underline">Back to streams</Link>
          <h1 className="mt-1 text-xl font-semibold text-kael-text">Stream Details</h1>
          <p className="text-sm text-kael-muted">{originId}</p>
        </div>
        <button
          type="button"
          onClick={() => analyze.mutate({ full: true, timeoutMs: 15_000 })}
          disabled={analyze.isPending || !stream.data}
          className="rounded-xl border border-kael-accent bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          {analyze.isPending ? "Analyzing..." : "Run ffprobe analysis"}
        </button>
      </div>

      {stream.isLoading && <Panel title="Loading"><p className="text-sm text-kael-muted">Loading stream...</p></Panel>}
      {stream.error && <Panel title="Error"><p className="text-sm text-rose-700">{stream.error.message}</p></Panel>}

      {stream.data && (
        <>
          <Panel title="Overview">
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="Protocol" value={stream.data.protocol ?? "hls"} />
              <Metric label="Duration" value={formatSeconds(stream.data.cumulativeDurationSeconds, 1)} />
              <Metric label="Segments" value={String(stream.data.segmentCount)} />
              <Metric label="Size" value={formatBytes(stream.data.bytes)} />
            </div>
            <div className="mt-3 grid gap-2 text-xs text-kael-muted md:grid-cols-2">
              <p className="truncate">Source: {stream.data.sourceUrl}</p>
              <p className="truncate">Selected: {stream.data.selectedUrl ?? "-"}</p>
              <p>Created: {formatDate(stream.data.createdAt)}</p>
              <p>Target duration: {formatSeconds(stream.data.targetDuration)}</p>
            </div>
            {stream.data.faults && stream.data.faults.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {stream.data.faults.map((fault) => (
                  <p key={`${fault.createdAt}-${fault.description}`}>{fault.description}</p>
                ))}
              </div>
            )}
          </Panel>

          {analyze.error && (
            <Panel title="ffprobe analysis">
              <p className="text-sm text-rose-700">{analyze.error.message}</p>
            </Panel>
          )}

          {analyze.data && <AnalysisSummary report={analyze.data} />}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel title="Manifests & Chunks">
              <div className="space-y-4">
                {groups.length === 0 && <p className="text-sm text-kael-muted">No media playlists found.</p>}
                {groups.map((group) => (
                  <MediaGroupView
                    key={`${group.kind}-${group.index}`}
                    group={group}
                    selected={selected}
                    analysis={analyze.data}
                    onSelect={(chunk) => setSelected(chunk)}
                  />
                ))}
              </div>
            </Panel>

            <ChunkDetails
              selected={selected}
              analysis={selectedAnalysis}
              analyzing={analyze.isPending}
              onAnalyzeSelected={() => {
                if (!selected) return;
                analyze.mutate({
                  full: true,
                  startSegment: selected.segment.originalIndex,
                  segmentCount: 1,
                  timeoutMs: 15_000,
                });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Metric(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-kael-border bg-kael-panelSoft p-3">
      <p className="text-xs text-kael-muted">{props.label}</p>
      <p className="mt-1 text-sm font-semibold text-kael-text">{props.value}</p>
    </div>
  );
}

function AnalysisSummary(props: { report: StreamAnalysisReport }): JSX.Element {
  const { report } = props;
  return (
    <Panel title="ffprobe analysis">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="Status" value={report.ok ? "OK" : "Issues found"} />
        <Metric label="Sampled chunks" value={String(report.sampledSegments)} />
        <Metric label="Failed chunks" value={String(report.failedSegments)} />
        <Metric label="A/V sync" value={report.avAlignment.status} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-kael-border bg-kael-panelSoft p-3 text-xs">
          <p className="font-medium text-kael-text">A/V alignment</p>
          <p className="mt-1 text-kael-muted">pairs: {report.avAlignment.comparedPairs}</p>
          <p className="text-kael-muted">duration delta: {formatSeconds(report.avAlignment.maxDurationDeltaSeconds)}</p>
          <p className="text-kael-muted">PTS start delta: {formatSeconds(report.avAlignment.maxStartPtsDeltaSeconds)}</p>
          <p className="text-kael-muted">timeline drift: {formatSeconds(report.avAlignment.maxTimelineDriftSeconds)}</p>
        </div>
        <div className="rounded-lg border border-kael-border bg-kael-panelSoft p-3 text-xs">
          <p className="font-medium text-kael-text">Issues</p>
          {report.issues.length === 0 && <p className="mt-1 text-kael-muted">No issues reported.</p>}
          {report.issues.slice(0, 4).map((issue) => (
            <div key={`${issue.code}-${issue.summary}`} className="mt-2 rounded border border-kael-border bg-white p-2">
              <p className="text-kael-muted">{issue.severity}: {issue.summary}</p>
              {issue.evidence.slice(0, 3).map((line) => (
                <p key={line} className="mt-1 break-all font-mono text-[11px] text-kael-muted">{line}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function MediaGroupView(props: {
  group: MediaGroup;
  selected: SelectedChunk | null;
  analysis?: StreamAnalysisReport;
  onSelect: (chunk: SelectedChunk) => void;
}): JSX.Element {
  const { group } = props;
  return (
    <section className="rounded-lg border border-kael-border bg-white">
      <div className="border-b border-kael-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-kael-text">{group.label}</p>
            <p className="mt-1 truncate text-xs text-kael-muted">{group.manifestPath}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-kael-muted">
            <span>{group.type}</span>
            <span>{group.segmentCount} chunks</span>
            <span>{formatSeconds(group.cumulativeDurationSeconds, 1)}</span>
            <span>{formatBytes(group.bytes)}</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 divide-y divide-kael-border">
        {group.segments.map((segment, segmentIndex) => {
          const entries = props.analysis?.entries.filter((candidate) =>
            candidate.kind === group.kind &&
            candidate.mediaIndex === group.index &&
            candidate.segmentIndex === segmentIndex
          ) ?? [];
          const entry = preferAnalysisEntry(entries);
          const active = props.selected?.group.kind === group.kind &&
            props.selected.group.index === group.index &&
            props.selected.segmentIndex === segmentIndex;
          return (
            <button
              key={`${segment.localUri}-${segmentIndex}`}
              type="button"
              onClick={() => props.onSelect({ group, segment, segmentIndex })}
              className={`grid min-h-[58px] grid-cols-[84px_minmax(0,1fr)_150px] items-center gap-3 px-3 py-2 text-left text-xs hover:bg-blue-50 ${active ? "bg-blue-50" : "bg-white"}`}
            >
              <div>
                <p className="font-semibold text-kael-text">#{segment.originalIndex}</p>
                <p className="text-kael-muted">local {segmentIndex}</p>
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-kael-text">{segment.localUri}</p>
                <p className="mt-1 text-kael-muted">
                  manifest {formatSeconds(segment.duration)} | actual {formatSeconds(entry?.actualDurationSeconds)}
                </p>
              </div>
              <div className="text-right">
                <p className={entry && !entry.ok ? "font-medium text-rose-700" : "text-kael-muted"}>
                  {entries.length > 0
                    ? `${entries.length} probe${entries.length === 1 ? "" : "s"}`
                    : "not probed"}
                </p>
                <p className="text-kael-muted">PTS {formatSeconds(entry?.firstPtsTime)} {"->"} {formatSeconds(entry?.lastPtsTime)}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ChunkDetails(props: {
  selected: SelectedChunk | null;
  analysis?: StreamAnalysisEntry[];
  analyzing: boolean;
  onAnalyzeSelected: () => void;
}): JSX.Element {
  if (!props.selected) {
    return (
      <Panel title="Chunk">
        <p className="text-sm text-kael-muted">Select a chunk to inspect manifest and ffprobe data.</p>
      </Panel>
    );
  }

  const { group, segment, segmentIndex } = props.selected;
  const analysis = props.analysis ?? [];
  return (
    <Panel title="Chunk">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-kael-text">{group.label}</p>
          <p className="mt-1 text-xs text-kael-muted">local chunk {segmentIndex} | original {segment.originalIndex}</p>
          <button
            type="button"
            onClick={props.onAnalyzeSelected}
            disabled={props.analyzing}
            className="mt-3 rounded-lg border border-kael-accent bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {props.analyzing ? "Analyzing..." : "Analyze selected chunk"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric label="Manifest duration" value={formatSeconds(segment.duration)} />
          <Metric label="Bytes" value={formatBytes(segment.bytes)} />
          <Metric label="Timeline start" value={formatSeconds(segment.timelineStartSeconds)} />
          <Metric label="Timeline end" value={formatSeconds(segment.timelineEndSeconds)} />
        </div>

        <div className="rounded-lg border border-kael-border bg-kael-panelSoft p-3 text-xs">
          <p className="font-medium text-kael-text">Manifest data</p>
          <p className="mt-2 break-all text-kael-muted">local: {segment.localUri}</p>
          <p className="mt-1 break-all text-kael-muted">source: {segment.sourceUrl}</p>
          {segment.map && <p className="mt-1 break-all text-kael-muted">init: {segment.map.localUri}</p>}
        </div>

        <div className="rounded-lg border border-kael-border bg-kael-panelSoft p-3 text-xs">
          <p className="font-medium text-kael-text">ffprobe data</p>
          {analysis.length === 0 && <p className="mt-2 text-kael-muted">Run ffprobe analysis to populate this chunk.</p>}
          {analysis.map((entry) => <AnalysisEntryDetails key={`${entry.type}-${entry.streamSelector ?? "stream"}`} entry={entry} />)}
        </div>
      </div>
    </Panel>
  );
}

function preferAnalysisEntry(entries: StreamAnalysisEntry[]): StreamAnalysisEntry | undefined {
  return entries.find((entry) => entry.type === "VIDEO") ?? entries[0];
}

function AnalysisEntryDetails(props: { entry: StreamAnalysisEntry }): JSX.Element {
  const { entry } = props;
  return (
    <div className="mt-3 rounded border border-kael-border bg-white p-2 text-kael-muted">
      <p className="font-medium text-kael-text">
        {entry.type} {entry.streamSelector ? `(${entry.streamSelector})` : ""}
      </p>
      <p>status: {entry.ok ? "ok" : "failed"}</p>
      <p>source: {entry.sourceKind ?? "-"}</p>
      <p>codec: {entry.codecName ?? "-"}</p>
      <p>streams: {entry.streamCount}</p>
      <p>sample rate: {entry.sampleRate ?? "-"}</p>
      <p>channels: {entry.channels ?? "-"}</p>
      <p>packets/samples: {entry.packetCount ?? "-"}</p>
      <p>actual duration: {formatSeconds(entry.actualDurationSeconds)}</p>
      <p>duration delta: {formatSignedSeconds(entry.durationDeltaSeconds)}</p>
      <p>PTS: {formatSeconds(entry.firstPtsTime)} {"->"} {formatSeconds(entry.lastPtsTime)}</p>
      <p>boundary: {entry.boundaryStatus ?? "-"} {formatSignedSeconds(entry.boundaryDeltaSeconds)}</p>
      <p>continuity: {entry.continuityStatus ?? "-"} {formatPtsDeltaUs(entry.nextDeltaUs)}</p>
      <p>keyframes: {entry.keyframeCount ?? "-"}</p>
      <p>starts with keyframe: {entry.startsWithKeyframe == null ? "-" : String(entry.startsWithKeyframe)}</p>
      <p>max keyframe gap: {formatSeconds(entry.maxKeyframeGapSeconds)}</p>
      {entry.errors.length > 0 && (
        <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-rose-700">
          {entry.errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}
    </div>
  );
}
