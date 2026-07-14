import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Panel } from "../components/Panel";
import {
  createStreamWatch,
  deleteStreamWatch,
  getStreamWatches,
  stopStreamWatch,
  type StreamWatch,
} from "../lib/api";
import { formatDate, statusTone } from "../lib/format";

function formatDurationMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function StreamWatchPage(): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [profile, setProfile] = useState<"manifest" | "chunks" | "full">("manifest");
  const [mode, setMode] = useState<"auto" | "vod" | "live">("auto");
  const [maxDurationMinutes, setMaxDurationMinutes] = useState("60");
  const [retentionHours, setRetentionHours] = useState("24");
  const [variantSelector, setVariantSelector] = useState("aac-highest");
  const [allVariants, setAllVariants] = useState(false);
  const [error, setError] = useState("");

  const watches = useQuery({
    queryKey: ["stream-watches"],
    queryFn: getStreamWatches,
    refetchInterval: 3_000,
  });

  const createMut = useMutation({
    mutationFn: () =>
      createStreamWatch({
        url,
        profile,
        mode,
        maxDurationMs: Math.max(1, Number(maxDurationMinutes) || 60) * 60_000,
        retentionHours: Math.max(1, Number(retentionHours) || 24),
        variantSelector: variantSelector.trim() || undefined,
        allVariants,
      }),
    onSuccess: async (watch) => {
      setUrl("");
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["stream-watches"] });
      navigate(`/streams/watch/${encodeURIComponent(watch.id)}`);
    },
    onError: (err: Error) => setError(err.message),
  });

  const stopMut = useMutation({
    mutationFn: async (watchId: string) => stopStreamWatch(watchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stream-watches"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (watchId: string) => deleteStreamWatch(watchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stream-watches"] });
    },
  });

  return (
    <div className="space-y-4">
      <Panel title="Create Watch">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_120px_100px_110px_110px_140px_auto] xl:items-end">
          <label className="min-w-0">
            <span className="mb-1 block text-xs text-kael-muted">HLS URL</span>
            <input
              type="text"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/index.m3u8"
              className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm focus:border-kael-accent focus:outline-none"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs text-kael-muted">Profile</span>
            <select value={profile} onChange={(event) => setProfile(event.target.value as typeof profile)} className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm">
              <option value="manifest">manifest</option>
              <option value="chunks">chunks</option>
              <option value="full">full</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-kael-muted">Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm">
              <option value="auto">auto</option>
              <option value="vod">vod</option>
              <option value="live">live</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-kael-muted">Max live</span>
            <input type="number" value={maxDurationMinutes} onChange={(event) => setMaxDurationMinutes(event.target.value)} className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm" />
          </label>
          <label>
            <span className="mb-1 block text-xs text-kael-muted">Retention h</span>
            <input type="number" value={retentionHours} onChange={(event) => setRetentionHours(event.target.value)} className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm" />
          </label>
          <label>
            <span className="mb-1 block text-xs text-kael-muted">Variant</span>
            <input type="text" value={variantSelector} onChange={(event) => setVariantSelector(event.target.value)} className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm" />
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-kael-muted">
              <input type="checkbox" checked={allVariants} onChange={(event) => setAllVariants(event.target.checked)} />
              All
            </label>
            <button
              type="button"
              onClick={() => createMut.mutate()}
              disabled={!url.trim() || createMut.isPending}
              className="rounded-xl border border-kael-accent bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {createMut.isPending ? "Starting..." : "Start"}
            </button>
          </div>
        </div>
        {profile !== "manifest" && (
          <p className="mt-2 text-xs text-kael-muted">
            Max live is {formatDurationMs(Math.max(1, Number(maxDurationMinutes) || 60) * 60_000)}. Chunk/full watches keep artifacts for {retentionHours || "24"}h.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      </Panel>

      <Panel title="Stream Watches">
        {watches.isLoading && <p className="text-sm text-kael-muted">Loading...</p>}
        {watches.data?.length === 0 && <p className="text-sm text-kael-muted">No stream watches yet.</p>}
        <div className="space-y-3">
          {watches.data?.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              onDetails={() => navigate(`/streams/watch/${encodeURIComponent(watch.id)}`)}
              onStop={() => stopMut.mutate(watch.id)}
              onDelete={() => {
                if (window.confirm(`Delete watch "${watch.id}" and its artifacts?`)) {
                  deleteMut.mutate(watch.id);
                }
              }}
              busy={stopMut.isPending || deleteMut.isPending}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function WatchCard(props: {
  watch: StreamWatch;
  onDetails: () => void;
  onStop: () => void;
  onDelete: () => void;
  busy: boolean;
}): JSX.Element {
  const { watch } = props;
  const progress =
    watch.totalSegmentCount && watch.totalSegmentCount > 0
      ? `${watch.analyzedSegmentCount}/${watch.totalSegmentCount}`
      : `${watch.analyzedSegmentCount}`;
  return (
    <div className="rounded-2xl border border-kael-border bg-kael-panelSoft p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-kael-text">{watch.id}</p>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(watch.state)}`}>{watch.state}</span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-kael-muted">{watch.profile}</span>
          </div>
          <p className="mt-1 truncate text-xs text-kael-muted">{watch.url}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-kael-muted">
            <span>mode: {watch.mode}</span>
            <span>input: {watch.inputType}</span>
            <span>polls: {watch.pollCount}</span>
            <span>downloaded: {watch.downloadedSegmentCount}</span>
            <span>analyzed: {progress}</span>
            <span>events: {watch.events.length}</span>
            <span>started: {formatDate(watch.startedAt)}</span>
            {watch.expiresAt && <span>expires: {formatDate(watch.expiresAt)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={props.onDetails} className="rounded-xl border border-kael-border bg-white px-3 py-1.5 text-xs font-medium text-kael-text hover:bg-kael-panel">
            Details
          </button>
          {watch.running && (
            <button type="button" onClick={props.onStop} disabled={props.busy} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
              Stop
            </button>
          )}
          {watch.report?.htmlPath && (
            <a href={`/api/streams/watch/${encodeURIComponent(watch.id)}/report.html`} target="_blank" rel="noreferrer" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
              Report
            </a>
          )}
          <button type="button" onClick={props.onDelete} disabled={props.busy} className="rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
