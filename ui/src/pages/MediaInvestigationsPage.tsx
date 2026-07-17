import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Panel } from "../components/Panel";
import { AgentAvatar, TypingDots } from "../components/investigation";
import {
  getMediaInvestigations,
  getStreams,
  startMediaInvestigation,
  type MediaInvestigation,
} from "../lib/api";
import { timeAgo } from "../lib/format";

export function MediaInvestigationsPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [originId, setOriginId] = useState(searchParams.get("originId") ?? "");
  const [problemStatement, setProblemStatement] = useState("");
  const [approximateTime, setApproximateTime] = useState("");
  const [fullAnalysis, setFullAnalysis] = useState(true);
  const investigations = useQuery({
    queryKey: ["media-investigations"],
    queryFn: getMediaInvestigations,
    refetchInterval: (query) => query.state.data?.investigations.some((item) => isActive(item.state)) ? 2_000 : 8_000,
  });
  const streams = useQuery({ queryKey: ["streams"], queryFn: getStreams });
  const selectableOrigins = useMemo(() => streams.data ?? [], [streams.data]);

  const start = useMutation({
    mutationFn: () => startMediaInvestigation({
      originId,
      problemStatement: problemStatement.trim(),
      ...(approximateTime.trim() ? { problemContext: { approximateTime: approximateTime.trim() } } : {}),
      fullAnalysis,
    }),
    onSuccess: async (record) => {
      await queryClient.invalidateQueries({ queryKey: ["media-investigations"] });
      navigate(`/investigations/${encodeURIComponent(record.id)}`);
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Panel title="Investigation Feed">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-blue-600 text-2xl shadow-sm">🕵️</span>
          <div>
            <p className="text-lg font-semibold text-kael-text">Um time de agentes investigando seu vídeo.</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-kael-muted">
              Você conta o que viu; 🎬 Timeline, 🎧 A/V e 📡 Delivery analisam as evidências em paralelo e o
              Lead publica a conclusão — tudo em uma timeline como uma rede social.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-kael-border bg-kael-panelSoft p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <div>
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-kael-muted">O que você viu de errado?</label>
              <textarea
                value={problemStatement}
                onChange={(event) => setProblemStatement(event.target.value)}
                rows={3}
                placeholder="Ex.: a imagem congela perto de 3s, mas o áudio continua normalmente"
                className="mt-2 w-full resize-y rounded-xl border border-kael-border bg-white px-3 py-2 text-sm text-kael-text focus:border-kael-accent focus:outline-none"
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.18em] text-kael-muted">Momento aproximado <span className="normal-case tracking-normal">(opcional)</span></label>
                  <input
                    value={approximateTime}
                    onChange={(event) => setApproximateTime(event.target.value)}
                    placeholder="Ex.: 00:00:03 ou entre 12s e 18s"
                    className="mt-2 w-full rounded-xl border border-kael-border bg-white px-3 py-2 text-sm text-kael-text focus:border-kael-accent focus:outline-none"
                  />
                </div>
                <label className="flex items-end gap-2 pb-2 text-sm text-kael-muted">
                  <input type="checkbox" checked={fullAnalysis} onChange={(event) => setFullAnalysis(event.target.checked)} />
                  Analisar todos os segmentos
                </label>
              </div>
            </div>
            <div className="flex flex-col">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-kael-muted">Origin clonado</label>
              <select
                value={originId}
                onChange={(event) => setOriginId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-kael-border bg-white px-3 py-2 text-sm text-kael-text focus:border-kael-accent focus:outline-none"
              >
                <option value="">Selecione um origin</option>
                {selectableOrigins.map((stream) => (
                  <option key={stream.id} value={stream.id}>{stream.id} · {stream.segmentCount} segments</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => start.mutate()}
                disabled={!originId || !problemStatement.trim() || start.isPending || investigations.data?.agentsAvailable === false}
                className="mt-auto w-full rounded-xl border border-blue-600 bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {start.isPending ? "Convocando o time..." : "🚀 Abrir investigação"}
              </button>
              {investigations.data?.agentsAvailable === false && (
                <p className="mt-2 text-xs text-amber-700">Configure KAEL_PI_API_KEY para ativar os especialistas.</p>
              )}
              {start.error && <p className="mt-2 text-xs text-rose-700">{(start.error as Error).message}</p>}
            </div>
          </div>
        </div>
      </Panel>

      {investigations.isLoading && <p className="text-sm text-kael-muted">Carregando feed...</p>}
      {investigations.error && <p className="text-sm text-rose-700">{(investigations.error as Error).message}</p>}
      {investigations.data?.investigations.length === 0 && (
        <div className="rounded-3xl border border-dashed border-kael-border bg-kael-panelSoft p-8 text-center">
          <p className="text-3xl">🛜</p>
          <p className="mt-2 text-sm text-kael-muted">Nenhuma investigação ainda. Abra a primeira e o time entra em cena.</p>
        </div>
      )}
      <div className="space-y-4">
        {investigations.data?.investigations.map((record) => <InvestigationPost key={record.id} record={record} />)}
      </div>
    </div>
  );
}

function InvestigationPost(props: { record: MediaInvestigation }): JSX.Element {
  const { record } = props;
  const active = isActive(record.state);
  return (
    <Link
      to={`/investigations/${encodeURIComponent(record.id)}`}
      className="group block rounded-3xl border border-kael-border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-glow"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex -space-x-2">
            {record.agents.map((agent) => (
              <span key={agent.id} className="rounded-full ring-2 ring-white">
                <AgentAvatar agent={agent} size="sm" />
              </span>
            ))}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-kael-text">Time de investigação</p>
            <p className="truncate text-xs text-kael-muted">caso <span className="font-medium text-kael-text">{record.originId}</span> · {timeAgo(record.createdAt)}</p>
          </div>
        </div>
        <StateBadge state={record.state} />
      </div>

      <p className="mt-4 text-[15px] leading-6 text-kael-text">“{record.problemStatement ?? "Triagem geral da mídia"}”</p>
      {record.problemContext?.approximateTime && (
        <p className="mt-1 text-xs text-kael-muted">⏱️ por volta de {record.problemContext.approximateTime}</p>
      )}

      {active && (
        <p className="mt-3 flex items-center gap-2 text-sm text-blue-700">
          <TypingDots /> agentes trabalhando nas evidências...
        </p>
      )}

      {record.synthesis && (
        <div className="mt-4 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">🕵️ Conclusão do Lead</p>
            <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-indigo-700">
              {Math.round(record.synthesis.confidence * 100)}% confiança
            </span>
          </div>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-kael-text">{record.synthesis.summary}</p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-kael-border pt-3 text-xs text-kael-muted">
        <span>{record.agents.filter((agent) => agent.state === "completed").length}/{record.agents.length} análises publicadas · {record.activities?.length ?? 0} checks</span>
        <span className="font-medium text-kael-accent group-hover:underline">Abrir timeline →</span>
      </div>
    </Link>
  );
}

export function StateBadge(props: { state: string }): JSX.Element {
  const tone = props.state === "completed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : props.state === "failed"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-blue-200 bg-blue-50 text-blue-700";
  return <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}>{props.state}</span>;
}

function isActive(state: string): boolean {
  return !["completed", "failed"].includes(state);
}
