import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Panel } from "../components/Panel";
import {
  deleteStreamWatch,
  getStreamWatch,
  stopStreamWatch,
  type StreamWatchChunk,
  type StreamWatchChunkStream,
} from "../lib/api";
import { formatDate, statusTone } from "../lib/format";

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
}

function formatSeconds(value: number | undefined): string {
  return value === undefined ? "-" : `${value.toFixed(3)}s`;
}

function formatSmallSeconds(value: number | undefined): string {
  if (value === undefined) return "-";
  if (value !== 0 && Math.abs(value) < 0.001) return `${value < 0 ? "-" : ""}<0.001s`;
  return `${value.toFixed(3)}s`;
}

function formatTime(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(6);
}

export function StreamWatchDetailPage(): JSX.Element {
  const { watchId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const watch = useQuery({
    queryKey: ["stream-watch", watchId],
    queryFn: () => getStreamWatch(watchId),
    enabled: Boolean(watchId),
    refetchInterval: 2_000,
  });

  const stopMut = useMutation({
    mutationFn: async () => stopStreamWatch(watchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stream-watch", watchId] });
      await queryClient.invalidateQueries({ queryKey: ["stream-watches"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async () => deleteStreamWatch(watchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stream-watches"] });
      navigate("/streams/watch");
    },
  });

  const data = watch.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link to="/streams/watch" className="text-sm text-kael-accent underline">Back to watches</Link>
        <div className="flex flex-wrap gap-2">
          {data?.running && (
            <button type="button" onClick={() => stopMut.mutate()} disabled={stopMut.isPending} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
              {stopMut.isPending ? "Stopping..." : "Stop"}
            </button>
          )}
          {data?.report?.htmlPath && (
            <a href={`/api/streams/watch/${encodeURIComponent(data.id)}/report.html`} target="_blank" rel="noreferrer" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
              Open Report
            </a>
          )}
          <button type="button" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} className="rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
            {deleteMut.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      {watch.isLoading && <Panel title="Watch"><p className="text-sm text-kael-muted">Loading...</p></Panel>}
      {watch.error && <Panel title="Watch"><p className="text-sm text-rose-700">{(watch.error as Error).message}</p></Panel>}

      {data && (
        <>
          <Panel title="Watch Summary">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-lg font-semibold text-kael-text">{data.id}</h3>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(data.state)}`}>{data.state}</span>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-kael-muted">{data.profile}</span>
              </div>
              <p className="break-all text-sm text-kael-muted">{data.url}</p>
              <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Mode" value={data.mode} />
                <Metric label="Input" value={data.inputType} />
                <Metric label="Polls" value={String(data.pollCount)} />
                <Metric label="Errors" value={String(data.errorCount)} />
                <Metric label="Downloaded" value={String(data.downloadedSegmentCount)} />
                <Metric label="Analyzed" value={data.totalSegmentCount ? `${data.analyzedSegmentCount}/${data.totalSegmentCount}` : String(data.analyzedSegmentCount)} />
                <Metric label="Started" value={formatDate(data.startedAt)} />
                <Metric label="Expires" value={formatDate(data.expiresAt)} />
              </div>
              {data.originId && (
                <Link to={`/streams/${encodeURIComponent(data.originId)}/details`} className="inline-flex rounded-xl border border-kael-border bg-white px-3 py-1.5 text-xs font-medium text-kael-text hover:bg-kael-panel">
                  Open cloned origin
                </Link>
              )}
            </div>
          </Panel>

          {data.recentChunks.length > 0 && (
            <Panel title="Runtime Chunks">
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-kael-muted">Last 5</p>
                <div className="grid gap-3 xl:grid-cols-5">
                  {data.recentChunks.slice().reverse().map((chunk) => (
                    <ChunkCard key={`${chunk.id}-${chunk.phase}`} chunk={chunk} />
                  ))}
                </div>
              </div>
            </Panel>
          )}

          <Panel title="Events">
            {data.events.length === 0 && <p className="text-sm text-kael-muted">No events detected yet.</p>}
            {data.events.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.18em] text-kael-muted">
                    <tr>
                      <th className="border-b border-kael-border px-2 py-2">Time</th>
                      <th className="border-b border-kael-border px-2 py-2">Severity</th>
                      <th className="border-b border-kael-border px-2 py-2">Code</th>
                      <th className="border-b border-kael-border px-2 py-2">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.slice().reverse().map((event, index) => (
                      <tr key={`${event.detectedAt}-${event.code}-${index}`} className="border-b border-kael-border/60">
                        <td className="whitespace-nowrap px-2 py-2 text-xs text-kael-muted">{formatDate(event.detectedAt)}</td>
                        <td className="px-2 py-2 text-xs">{event.severity}</td>
                        <td className="px-2 py-2 font-mono text-xs">{event.code}</td>
                        <td className="px-2 py-2 text-kael-text">{event.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function ChunkCard(props: { chunk: StreamWatchChunk }): JSX.Element {
  const { chunk } = props;
  const videoStream = chunk.streams?.find((stream) => stream.streamSelector === "v:0");
  const audioStream = chunk.streams?.find((stream) => stream.streamSelector === "a:0");
  const tone = chunk.phase === "failed"
    ? "border-rose-200 bg-rose-50"
    : chunk.phase === "analyzed"
      ? "border-emerald-200 bg-emerald-50"
      : chunk.phase === "downloading" || chunk.phase === "analyzing"
        ? "border-sky-200 bg-sky-50"
        : "border-kael-border bg-kael-panelSoft";
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-kael-text">
          v{chunk.variantIndex + 1}/{chunk.variantCount} · seg {chunk.segmentIndex + 1}/{chunk.segmentCount}
        </p>
        <span className="rounded-full border border-white/80 bg-white px-2 py-0.5 text-[11px] text-kael-muted">
          {chunk.phase}
        </span>
      </div>
      <div className="mt-2 grid gap-1 text-xs text-kael-muted">
        <span>original: {chunk.originalSegmentIndex ?? "-"}</span>
        <span>bytes: {formatBytes(chunk.bytes)}</span>
        <span>declared: {formatSeconds(chunk.durationSeconds)}</span>
        <span>actual: {formatSeconds(chunk.actualDurationSeconds)}</span>
        <span>delta: {formatSeconds(chunk.durationDeltaSeconds)}</span>
        <span>type: {chunk.streamType ?? "-"}</span>
        <span>codec: {chunk.codecName ?? "-"}</span>
        <span>stream: {chunk.streamSelector ?? "-"}</span>
        <span>continuity: {chunk.continuityStatus ?? "-"}</span>
        <span>keyframes: {chunk.keyframeCount ?? "-"}</span>
        <span>starts keyframe: {chunk.startsWithKeyframe === undefined ? "-" : String(chunk.startsWithKeyframe)}</span>
        <span>PTS end {"<-"} start: {formatTime(chunk.lastPtsTime)} {"<-"} {formatTime(chunk.firstPtsTime)}</span>
        <span>DTS end {"<-"} start: {formatTime(chunk.lastDtsTime)} {"<-"} {formatTime(chunk.firstDtsTime)}</span>
        <span>A/V end diff: {formatSeconds(chunk.avEndPtsDeltaSeconds)}</span>
        <span>A/V start diff: {formatSeconds(chunk.avStartPtsDeltaSeconds)}</span>
        <span>video boundary gap: {formatSmallSeconds(videoStream?.previousPtsDeltaSeconds)} status: {videoStream?.previousBoundaryStatus ?? "-"}</span>
        <span>audio boundary gap: {formatSmallSeconds(audioStream?.previousPtsDeltaSeconds)} status: {audioStream?.previousBoundaryStatus ?? "-"}</span>
        <span>A/V boundary skew: {formatSmallSeconds(chunk.avBoundaryDeltaSeconds)} status: {chunk.avBoundaryStatus ?? "-"}</span>
      </div>
      {chunk.streams && chunk.streams.length > 0 && (
        <div className="mt-3 space-y-2">
          {chunk.streams.map((stream) => (
            <StreamProbeCard key={stream.streamSelector} stream={stream} />
          ))}
        </div>
      )}
      {(chunk.url || chunk.localUri) && (
        <div className="mt-2 space-y-1 text-[11px] text-kael-muted">
          {chunk.localUri && <p className="truncate">local: {chunk.localUri}</p>}
          {chunk.url && <p className="truncate">source: {chunk.url}</p>}
        </div>
      )}
      {chunk.errors.length > 0 && (
        <div className="mt-2 space-y-1 text-xs text-rose-700">
          {chunk.errors.slice(0, 2).map((error) => (
            <p key={error} className="truncate">{error}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function StreamProbeCard(props: { stream: StreamWatchChunkStream }): JSX.Element {
  const { stream } = props;
  return (
    <div className="rounded-lg border border-white/80 bg-white/70 p-2 text-[11px] text-kael-muted">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono text-kael-text">{stream.streamSelector}</span>
        <span>{stream.streamType ?? "-"} · {stream.codecName ?? "-"}</span>
      </div>
      <div className="grid gap-1">
        <span>duration: {formatSeconds(stream.actualDurationSeconds)} delta: {formatSeconds(stream.durationDeltaSeconds)}</span>
        <span>PTS end {"<-"} start: {formatTime(stream.lastPtsTime)} {"<-"} {formatTime(stream.firstPtsTime)}</span>
        <span>DTS end {"<-"} start: {formatTime(stream.lastDtsTime)} {"<-"} {formatTime(stream.firstDtsTime)}</span>
        <span>last sample: {formatSmallSeconds(stream.lastSampleDurationSeconds)}</span>
        <span>boundary gap: {formatSmallSeconds(stream.previousPtsDeltaSeconds)} status: {stream.previousBoundaryStatus ?? "-"}</span>
        <span>samples: {stream.sampleCount ?? "-"} keyframes: {stream.keyframeCount ?? "-"}</span>
        <span>starts keyframe: {stream.startsWithKeyframe === undefined ? "-" : String(stream.startsWithKeyframe)}</span>
      </div>
      {stream.errors.length > 0 && (
        <div className="mt-1 space-y-1 text-rose-700">
          {stream.errors.slice(0, 2).map((error) => (
            <p key={error} className="truncate">{error}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-kael-border bg-kael-panelSoft p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-kael-muted">{props.label}</p>
      <p className="mt-1 truncate text-sm font-medium text-kael-text">{props.value}</p>
    </div>
  );
}
