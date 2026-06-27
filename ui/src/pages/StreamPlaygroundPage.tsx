import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Clappr from "@clappr/player";
import HlsjsPlayback from "@clappr/hlsjs-playback";
import { Panel } from "../components/Panel";
import { getStream } from "../lib/api";
import { formatDate } from "../lib/format";

function ClapprHlsPlayer(props: { source: string; reloadKey: number; hlsDebug: boolean }): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mountRef.current || !props.source.trim()) {
      return undefined;
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
      },
      playback: {
        hlsjsConfig: {
          debug: props.hlsDebug,
          enableWorker: true,
        },
      },
    });

    return () => {
      player.destroy();
    };
  }, [props.hlsDebug, props.reloadKey, props.source]);

  return <div ref={mountRef} className="h-full min-h-[360px] w-full overflow-hidden rounded-2xl bg-black" />;
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
    setReloadKey((current) => current + 1);
    if (nextUrl) {
      setSearchParams({ url: nextUrl });
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

          <div className="aspect-video min-h-[360px] w-full overflow-hidden rounded-2xl border border-kael-border bg-black">
            {resolvedUrl ? (
              <ClapprHlsPlayer source={resolvedUrl} reloadKey={reloadKey} hlsDebug={hlsDebug} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-400">
                No playback URL available.
              </div>
            )}
          </div>
        </div>
      </Panel>

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
