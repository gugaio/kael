import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "../components/Panel";
import { cloneStream, deleteStream, getStreams, serveStream, stopStream, type StreamItem } from "../lib/api";
import { formatDate } from "../lib/format";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function StreamsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneId, setCloneId] = useState("");
  const [cloneDuration, setCloneDuration] = useState("60");
  const [cloneAllVariants, setCloneAllVariants] = useState(false);
  const [cloneError, setCloneError] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const streams = useQuery({ queryKey: ["streams"], queryFn: getStreams, refetchInterval: 5_000 });

  const cloneMut = useMutation({
    mutationFn: () =>
      cloneStream({
        url: cloneUrl,
        originId: cloneId.trim() || undefined,
        durationSeconds: Number(cloneDuration) || 60,
        allVariants: cloneAllVariants,
      }),
    onSuccess: async () => {
      setCloneUrl("");
      setCloneId("");
      setCloneError("");
      await queryClient.invalidateQueries({ queryKey: ["streams"] });
    },
    onError: (err: Error) => {
      setCloneError(err.message);
    },
  });

  const serveMut = useMutation({
    mutationFn: async (originId: string) => serveStream(originId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["streams"] });
    },
  });

  const serveLanMut = useMutation({
    mutationFn: async (originId: string) => serveStream(originId, { host: "0.0.0.0" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["streams"] });
    },
  });

  const stopMut = useMutation({
    mutationFn: async (originId: string) => stopStream(originId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["streams"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (originId: string) => deleteStream(originId),
    onSuccess: async () => {
      setDeleteError("");
      await queryClient.invalidateQueries({ queryKey: ["streams"] });
    },
    onError: (err: Error) => {
      setDeleteError(err.message);
    },
  });

  const playMut = useMutation({
    mutationFn: async (stream: StreamItem) => {
      if (stream.serving && stream.servingUrl) {
        return { originId: stream.id, playbackUrl: stream.servingUrl };
      }
      const result = await serveStream(stream.id);
      return { originId: stream.id, playbackUrl: result.serve.playbackUrl };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["streams"] });
      navigate(`/streams/${encodeURIComponent(result.originId)}/playground?url=${encodeURIComponent(result.playbackUrl)}`);
    },
  });

  return (
    <div className="space-y-4">
      <Panel title="Clone New Stream">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-[2]">
            <label className="block text-xs text-kael-muted mb-1">HLS URL</label>
            <input
              type="text"
              value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              placeholder="https://example.com/stream.m3u8"
              className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm focus:border-kael-accent focus:outline-none"
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-kael-muted mb-1">ID (opcional)</label>
            <input
              type="text"
              value={cloneId}
              onChange={(e) => setCloneId(e.target.value)}
              placeholder="uuid-auto"
              className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm focus:border-kael-accent focus:outline-none"
            />
          </div>
          <div className="w-24">
            <label className="block text-xs text-kael-muted mb-1">Duration (s)</label>
            <input
              type="number"
              value={cloneDuration}
              onChange={(e) => setCloneDuration(e.target.value)}
              className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm focus:border-kael-accent focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={cloneAllVariants}
              onChange={(e) => setCloneAllVariants(e.target.checked)}
              className="rounded border-kael-border"
            />
            All variants
          </label>
          <button
            type="button"
            onClick={() => cloneMut.mutate()}
            disabled={!cloneUrl.trim() || cloneMut.isPending}
            className="rounded-xl border border-kael-accent bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {cloneMut.isPending ? "Cloning..." : "Clone"}
          </button>
        </div>
        {cloneError && <p className="mt-2 text-sm text-rose-700">{cloneError}</p>}
      </Panel>

      <Panel title="Cloned Streams">
        {streams.isLoading && <p className="text-sm text-kael-muted">Loading...</p>}
        {deleteError && <p className="mb-2 text-sm text-rose-700">{deleteError}</p>}
        {streams.data && streams.data.length === 0 && (
          <p className="text-sm text-kael-muted">No cloned streams yet. Clone one above.</p>
        )}
        {streams.data && streams.data.length > 0 && (
          <div className="space-y-3">
            {streams.data.map((stream) => (
              <StreamCard
                key={stream.id}
                stream={stream}
                onServe={() => serveMut.mutate(stream.id)}
                onServeLan={() => serveLanMut.mutate(stream.id)}
                onStop={() => stopMut.mutate(stream.id)}
                onDelete={() => deleteMut.mutate(stream.id)}
                onPlay={() => playMut.mutate(stream)}
                onDetails={() => navigate(`/streams/${encodeURIComponent(stream.id)}/details`)}
                servePending={serveMut.isPending}
                serveLanPending={serveLanMut.isPending}
                stopPending={stopMut.isPending}
                deletePending={deleteMut.isPending}
                playPending={playMut.isPending}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function StreamCard(props: {
  stream: StreamItem;
  onServe: () => void;
  onServeLan: () => void;
  onStop: () => void;
  onDelete: () => void;
  onPlay: () => void;
  onDetails: () => void;
  servePending: boolean;
  serveLanPending: boolean;
  stopPending: boolean;
  deletePending: boolean;
  playPending: boolean;
}): JSX.Element {
  const { stream } = props;
  const confirmDelete = (): void => {
    if (window.confirm(`Delete cloned stream "${stream.id}" from local storage?`)) {
      props.onDelete();
    }
  };

  return (
    <div className="rounded-2xl border border-kael-border bg-kael-panelSoft p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-kael-text">{stream.id}</p>
            {stream.serving && (
              <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                Serving
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-kael-muted">{stream.sourceUrl}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-kael-muted">
            <span>protocol: {stream.protocol ?? "hls"}</span>
            <span>duration: {formatDuration(stream.cumulativeDurationSeconds)}</span>
            <span>segments: {stream.segmentCount}</span>
            <span>variants: {stream.variantCount}</span>
            <span>size: {formatBytes(stream.bytes)}</span>
            <span>cloned: {formatDate(stream.createdAt)}</span>
          </div>
          {stream.serving && stream.servingUrl && (
            <div className="mt-2 space-y-1 text-xs">
              <a
                href={stream.servingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-kael-accent underline"
              >
                local: {stream.servingUrl}
              </a>
              {stream.networkServingUrl && (
                <a
                  href={stream.networkServingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-emerald-700 underline"
                >
                  LAN: {stream.networkServingUrl}
                </a>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={props.onDetails}
            className="rounded-xl border border-kael-border bg-white px-3 py-1.5 text-xs font-medium text-kael-text hover:bg-kael-panel"
          >
            Details
          </button>
          <button
            type="button"
            onClick={props.onPlay}
            disabled={props.playPending}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {props.playPending ? "Opening..." : "Play"}
          </button>
          {stream.serving ? (
            <button
              type="button"
              onClick={props.onStop}
              disabled={props.stopPending}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              {props.stopPending ? "Stopping..." : "Stop"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={props.onServe}
                disabled={props.servePending || props.serveLanPending}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                {props.servePending ? "Serving..." : "Serve"}
              </button>
              <button
                type="button"
                onClick={props.onServeLan}
                disabled={props.servePending || props.serveLanPending}
                className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                {props.serveLanPending ? "Serving..." : "Serve LAN"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={confirmDelete}
            disabled={props.deletePending}
            className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
          >
            {props.deletePending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
