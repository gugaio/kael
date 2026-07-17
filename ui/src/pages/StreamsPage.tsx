import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cloneStream, deleteStream, getStreams, serveStream, stopStream, type StreamItem } from "../lib/api";
import { timeAgo } from "../lib/format";

const GRADIENTS = [
  "from-indigo-600 via-violet-600 to-fuchsia-600",
  "from-blue-600 via-sky-500 to-cyan-500",
  "from-slate-800 via-slate-700 to-blue-900",
  "from-rose-500 via-pink-600 to-orange-500",
  "from-emerald-600 via-teal-600 to-cyan-700",
  "from-amber-500 via-orange-600 to-rose-600",
];

function hashString(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

function seededHeights(seed: number, count: number): number[] {
  let state = seed || 1;
  const heights: number[] = [];
  for (let index = 0; index < count; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    heights.push(25 + (state / 0xffffffff) * 75);
  }
  return heights;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
}

function formatTimestamp(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
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

  const items = streams.data ?? [];
  const servingCount = items.filter((stream) => stream.serving).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-kael-text">Streams</h1>
          <p className="mt-1 text-sm text-kael-muted">
            {streams.data
              ? `${items.length} ${items.length === 1 ? "origem clonada" : "origens clonadas"}${servingCount > 0 ? ` · ${servingCount} no ar` : ""}`
              : "Origens clonadas para playback e inspeção local."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/streams/watch")}
          className="rounded-xl border border-kael-border bg-kael-panel px-3.5 py-2 text-xs font-medium text-kael-text transition hover:border-kael-accent/50 hover:text-kael-accent"
        >
          Assistir uma URL →
        </button>
      </header>

      <section className="rounded-[24px] border border-kael-border bg-kael-panel p-4 shadow-glow">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-[2] basis-64">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-kael-muted">
              URL HLS
            </label>
            <input
              type="text"
              value={cloneUrl}
              onChange={(event) => setCloneUrl(event.target.value)}
              placeholder="https://exemplo.com/stream.m3u8"
              className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm focus:border-kael-accent focus:outline-none"
            />
          </div>
          <div className="w-36">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-kael-muted">
              ID (opcional)
            </label>
            <input
              type="text"
              value={cloneId}
              onChange={(event) => setCloneId(event.target.value)}
              placeholder="uuid-auto"
              className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm focus:border-kael-accent focus:outline-none"
            />
          </div>
          <div className="w-24">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-kael-muted">
              Duração (s)
            </label>
            <input
              type="number"
              value={cloneDuration}
              onChange={(event) => setCloneDuration(event.target.value)}
              className="w-full rounded-xl border border-kael-border bg-kael-panelSoft px-3 py-2 text-sm focus:border-kael-accent focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 pb-2.5 text-sm text-kael-muted">
            <input
              type="checkbox"
              checked={cloneAllVariants}
              onChange={(event) => setCloneAllVariants(event.target.checked)}
              className="rounded border-kael-border"
            />
            Todas as variantes
          </label>
          <button
            type="button"
            onClick={() => cloneMut.mutate()}
            disabled={!cloneUrl.trim() || cloneMut.isPending}
            className="rounded-xl bg-kael-accent px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {cloneMut.isPending ? "Clonando…" : "Clonar"}
          </button>
        </div>
        {cloneError && <p className="mt-2 text-sm text-rose-700">{cloneError}</p>}
      </section>

      {deleteError && <p className="text-sm text-rose-700">{deleteError}</p>}

      {streams.isLoading && (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="overflow-hidden rounded-[20px] border border-kael-border bg-kael-panel">
              <div className="aspect-video animate-pulse bg-kael-panelSoft" />
              <div className="space-y-2 p-4">
                <div className="h-3 w-2/3 animate-pulse rounded bg-kael-panelSoft" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-kael-panelSoft" />
              </div>
            </div>
          ))}
        </div>
      )}

      {streams.data && items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-kael-border bg-kael-panel/60 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-lg text-white shadow-glow">
            ▶
          </div>
          <p className="mt-4 text-sm font-semibold text-kael-text">Nenhum stream clonado ainda</p>
          <p className="mt-1 max-w-sm text-sm text-kael-muted">
            Cole uma URL HLS acima e o Kael traz a origem para playback e inspeção local.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((stream) => (
            <StreamCard
              key={stream.id}
              stream={stream}
              onServe={() => serveMut.mutate(stream.id)}
              onServeLan={() => serveLanMut.mutate(stream.id)}
              onStop={() => stopMut.mutate(stream.id)}
              onDelete={() => deleteMut.mutate(stream.id)}
              onPlay={() => playMut.mutate(stream)}
              onDetails={() => navigate(`/streams/${encodeURIComponent(stream.id)}/details`)}
              onInvestigate={() => navigate(`/investigations?originId=${encodeURIComponent(stream.id)}`)}
              servePending={serveMut.isPending && serveMut.variables === stream.id}
              serveLanPending={serveLanMut.isPending && serveLanMut.variables === stream.id}
              stopPending={stopMut.isPending && stopMut.variables === stream.id}
              deletePending={deleteMut.isPending && deleteMut.variables === stream.id}
              playPending={playMut.isPending && playMut.variables?.id === stream.id}
            />
          ))}
        </div>
      )}
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
  onInvestigate: () => void;
  servePending: boolean;
  serveLanPending: boolean;
  stopPending: boolean;
  deletePending: boolean;
  playPending: boolean;
}): JSX.Element {
  const { stream } = props;
  const [thumbFailed, setThumbFailed] = useState(false);
  const seed = hashString(stream.id);
  const gradient = GRADIENTS[seed % GRADIENTS.length];
  const barCount = Math.max(10, Math.min(36, stream.segmentCount || 18));
  const bars = seededHeights(seed, barCount);

  const confirmDelete = (): void => {
    if (window.confirm(`Excluir o stream "${stream.id}" do armazenamento local?`)) {
      props.onDelete();
    }
  };

  return (
    <article className="group overflow-hidden rounded-[20px] border border-kael-border bg-kael-panel transition hover:-translate-y-0.5 hover:shadow-glow">
      <button
        type="button"
        onClick={props.onPlay}
        disabled={props.playPending}
        className="relative block aspect-video w-full overflow-hidden text-left"
        title={stream.sourceUrl}
      >
        <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_15%,rgba(255,255,255,0.22),transparent_55%)]" />
        <div className="absolute inset-x-5 bottom-4 flex h-10 items-end gap-[3px] opacity-70">
          {bars.map((height, index) => (
            <span
              key={index}
              className="min-w-[2px] flex-1 rounded-full bg-white/70"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        {!thumbFailed && (
          <img
            src={`/api/streams/${encodeURIComponent(stream.id)}/thumbnail.jpg`}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            {stream.protocol ?? "hls"}
          </span>
        </div>
        {stream.serving && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300 backdrop-blur-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            no ar
          </span>
        )}
        <span className="absolute bottom-3 right-3 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white">
          {formatTimestamp(stream.cumulativeDurationSeconds)}
        </span>

        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 scale-90 items-center justify-center rounded-full bg-white/25 text-lg text-white opacity-0 backdrop-blur-md transition group-hover:scale-100 group-hover:opacity-100">
            {props.playPending ? "…" : "▶"}
          </span>
        </div>
      </button>

      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-kael-text" title={stream.id}>
            {stream.id}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-kael-muted" title={stream.sourceUrl}>
            {prettyUrl(stream.sourceUrl)}
          </p>
        </div>

        <p className="text-xs text-kael-muted">
          {stream.segmentCount} {stream.segmentCount === 1 ? "segmento" : "segmentos"} ·{" "}
          {stream.variantCount} {stream.variantCount === 1 ? "variante" : "variantes"} ·{" "}
          {formatBytes(stream.bytes)} · clonado {timeAgo(stream.createdAt)}
        </p>

        {stream.serving && stream.servingUrl && (
          <div className="space-y-1.5">
            <CopyChip label="local" url={stream.servingUrl} />
            {stream.networkServingUrl && <CopyChip label="LAN" url={stream.networkServingUrl} />}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={props.onPlay}
            disabled={props.playPending}
            className="rounded-xl bg-kael-accent px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {props.playPending ? "Abrindo…" : "▶ Assistir"}
          </button>
          {stream.serving ? (
            <button
              type="button"
              onClick={props.onStop}
              disabled={props.stopPending}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
            >
              {props.stopPending ? "Parando…" : "Parar"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={props.onServe}
                disabled={props.servePending || props.serveLanPending}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
              >
                {props.servePending ? "Servindo…" : "Servir"}
              </button>
              <button
                type="button"
                onClick={props.onServeLan}
                disabled={props.servePending || props.serveLanPending}
                className="rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                title="Servir acessível na rede local"
              >
                {props.serveLanPending ? "Servindo…" : "LAN"}
              </button>
            </>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={props.onDetails}
            className="text-xs font-medium text-kael-muted transition hover:text-kael-text"
          >
            Detalhes
          </button>
          <button
            type="button"
            onClick={props.onInvestigate}
            className="text-xs font-medium text-kael-muted transition hover:text-indigo-600"
          >
            Investigar
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={props.deletePending}
            className="text-xs font-medium text-rose-500 transition hover:text-rose-700 disabled:opacity-50"
          >
            {props.deletePending ? "Excluindo…" : "Excluir"}
          </button>
        </div>
      </div>
    </article>
  );
}

function CopyChip(props: { label: string; url: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.url);
      setCopied(true);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={props.url}
      className="flex w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2 py-1 text-left transition hover:bg-emerald-50"
    >
      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
        {props.label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-emerald-900">{props.url}</span>
      <span className="shrink-0 text-[10px] font-medium text-emerald-600">{copied ? "copiado!" : "copiar"}</span>
    </button>
  );
}
